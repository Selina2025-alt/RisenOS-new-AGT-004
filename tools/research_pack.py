from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from intelligence_common import (
    INTELLIGENCE,
    ROOT,
    IntelligenceError,
    append_audit,
    atomic_write_json,
    atomic_write_text,
    canonicalize_url,
    china_now,
    isoformat,
    load_json,
    redact_sensitive_text,
    safe_slug,
    sha256_value,
    short_hash,
)


ROLES = {"primary", "secondary", "opinion", "lead_only"}
TIERS = {"S", "A", "B", "C", "D"}
VERIFICATION = {"verified", "metadata_only", "unverified", "rejected"}


def _normalize_source(raw: dict[str, Any], index: int) -> dict[str, Any]:
    title = redact_sensitive_text(raw.get("title", "")).strip()
    canonical, url_status = canonicalize_url(raw.get("url", ""))
    if not title:
        raise IntelligenceError(f"source[{index}] title is required")
    role = str(raw.get("sourceRole", "lead_only"))
    tier = str(raw.get("authorityTier", "C")).upper()
    verification = str(raw.get("verificationStatus", "unverified"))
    if role not in ROLES:
        raise IntelligenceError(f"source[{index}] has invalid sourceRole")
    if tier not in TIERS:
        raise IntelligenceError(f"source[{index}] has invalid authorityTier")
    if verification not in VERIFICATION:
        raise IntelligenceError(f"source[{index}] has invalid verificationStatus")
    warnings = [
        redact_sensitive_text(value)[:300]
        for value in raw.get("qualityWarnings", [])
        if str(value).strip()
    ]
    if url_status == "rejected":
        canonical = ""
        verification = "rejected"
        warnings.append("URL 未通过安全校验。")
    summary = redact_sensitive_text(raw.get("summary", "")).strip()[:2000]
    excerpts = [
        redact_sensitive_text(value).strip()[:1200]
        for value in raw.get("relevantExcerpts", [])
        if str(value).strip()
    ][:5]
    seed = canonical or f"{title}|{raw.get('publisher', '')}|{index}"
    return {
        "sourceId": raw.get("sourceId") or f"SRC-{short_hash(seed, 12)}",
        "title": title[:500],
        "url": canonical,
        "sourceType": redact_sensitive_text(raw.get("sourceType", "article"))[:100],
        "sourceRole": role,
        "publisher": redact_sensitive_text(raw.get("publisher", ""))[:200],
        "author": redact_sensitive_text(raw.get("author", ""))[:200] or None,
        "publishedAt": raw.get("publishedAt"),
        "retrievedAt": raw.get("retrievedAt") or isoformat(),
        "summary": summary,
        "relevantExcerpts": excerpts,
        "keyFacts": [
            redact_sensitive_text(value).strip()[:500]
            for value in raw.get("keyFacts", [])
            if str(value).strip()
        ][:10],
        "viewpoints": [
            redact_sensitive_text(value).strip()[:500]
            for value in raw.get("viewpoints", [])
            if str(value).strip()
        ][:10],
        "contentHash": raw.get("contentHash") or sha256_value(
            {"title": title, "url": canonical, "summary": summary, "excerpts": excerpts}
        ),
        "authorityTier": tier,
        "verificationStatus": verification,
        "accessStatus": raw.get("accessStatus", "accessible" if canonical else "unavailable"),
        "rightsStatus": raw.get("rightsStatus", "reference_only"),
        "qualityWarnings": warnings,
    }


def _normalize_claim(
    raw: dict[str, Any], index: int, source_ids: set[str]
) -> tuple[dict[str, Any], str | None]:
    statement = redact_sensitive_text(raw.get("statement", "")).strip()
    if not statement:
        raise IntelligenceError(f"claim[{index}] statement is required")
    claim_type = str(raw.get("claimType", "factual"))
    bound = [source_id for source_id in raw.get("sourceIds", []) if source_id in source_ids]
    gap = None
    if claim_type == "factual" and not bound:
        gap = f"事实性 Claim 缺少有效来源：{statement[:100]}"
    return (
        {
            "claimId": raw.get("claimId") or f"C-{index + 1:03d}",
            "statement": statement[:1000],
            "claimType": claim_type,
            "sourceIds": bound,
            "evidenceStatus": "SUPPORTED" if bound else "UNSUPPORTED",
        },
        gap,
    )


def _render_pack(pack: dict[str, Any]) -> str:
    lines = [
        f"# Research Pack｜{pack['topic']}",
        "",
        f"- Research Pack ID：`{pack['researchPackId']}`",
        f"- Mission ID：`{pack['missionId']}`",
        f"- 状态：{pack['status']}",
        f"- 来源数：{len(pack['sources'])}",
        "",
        "## 来源资料",
        "",
    ]
    for source in pack["sources"]:
        lines.extend(
            [
                f"### {source['sourceId']}｜{source['title']}",
                "",
                f"- 来源角色：{source['sourceRole']}；等级：{source['authorityTier']}；核验：{source['verificationStatus']}",
                f"- 链接：{source['url'] or '未通过安全校验或不可访问'}",
                f"- 摘要：{source['summary'] or '无'}",
                "",
            ]
        )
    lines.extend(["## Claim—Evidence 映射", ""])
    for claim in pack["claims"]:
        lines.append(
            f"- `{claim['claimId']}` {claim['statement']}｜{claim['evidenceStatus']}｜"
            f"{', '.join(claim['sourceIds']) or '无来源'}"
        )
    if pack["evidenceGaps"]:
        lines.extend(["", "## 证据缺口", ""])
        lines.extend(f"- {gap}" for gap in pack["evidenceGaps"])
    lines.append("")
    return "\n".join(lines)


def build_research_pack(mission_id: str, input_path: Path) -> Path:
    mission_dir = ROOT / "missions" / safe_slug(mission_id, "mission")
    mission_path = mission_dir / "mission.json"
    if not mission_path.exists():
        raise IntelligenceError(f"Mission not found: {mission_id}")
    mission = load_json(mission_path)
    payload = load_json(input_path)
    if not isinstance(payload, dict):
        raise IntelligenceError("Research input must be a JSON object")
    raw_sources = payload.get("sources", [])
    raw_claims = payload.get("claims", [])
    if not isinstance(raw_sources, list) or not isinstance(raw_claims, list):
        raise IntelligenceError("sources and claims must be arrays")

    sources = [_normalize_source(raw, index) for index, raw in enumerate(raw_sources)]
    source_ids = {source["sourceId"] for source in sources}
    claims: list[dict[str, Any]] = []
    evidence_gaps = [
        redact_sensitive_text(value)[:500]
        for value in payload.get("evidenceGaps", [])
        if str(value).strip()
    ]
    for index, raw in enumerate(raw_claims):
        if not isinstance(raw, dict):
            raise IntelligenceError(f"claim[{index}] must be an object")
        claim, gap = _normalize_claim(raw, index, source_ids)
        claims.append(claim)
        if gap:
            evidence_gaps.append(gap)

    valid_sources = [
        source
        for source in sources
        if source["url"]
        and source["verificationStatus"] not in {"rejected"}
        and source["authorityTier"] != "D"
    ]
    source_types = {source["sourceType"] for source in valid_sources}
    strong_sources = [
        source
        for source in valid_sources
        if source["authorityTier"] in {"S", "A"}
        and source["sourceRole"] in {"primary", "secondary"}
    ]
    minimum_ready = (
        len(valid_sources) >= 8
        and len(source_types) >= 3
        and len(strong_sources) >= 2
        and not evidence_gaps
    )
    status = "RESEARCH_READY" if minimum_ready else "EVIDENCE_INSUFFICIENT"
    created_at = china_now()
    pack_seed = {
        "missionId": mission_id,
        "sources": sources,
        "claims": claims,
        "evidenceGaps": evidence_gaps,
    }
    content_hash = sha256_value(pack_seed)
    pack_id = f"RP-{mission_id.replace('MISSION-', '')}-{content_hash[:10]}"
    pack = {
        "schemaVersion": "1.0",
        "researchPackId": pack_id,
        "missionId": mission_id,
        "topic": mission["topic"],
        "status": status,
        "sources": sources,
        "claims": claims,
        "evidenceGaps": evidence_gaps,
        "metrics": {
            "validSourceCount": len(valid_sources),
            "sourceTypeCount": len(source_types),
            "strongSourceCount": len(strong_sources),
            "factualClaimCount": sum(1 for claim in claims if claim["claimType"] == "factual"),
            "unsupportedClaimCount": sum(
                1 for claim in claims if claim["evidenceStatus"] == "UNSUPPORTED"
            ),
        },
        "createdAt": isoformat(created_at),
        "contentHash": content_hash,
    }
    version = f"V-{created_at.strftime('%Y%m%dT%H%M%S')}-{content_hash[:8]}"
    output_dir = INTELLIGENCE / "research" / safe_slug(mission_id, "mission") / version
    atomic_write_json(output_dir / "research-pack.json", pack)
    atomic_write_text(output_dir / "research-pack.md", _render_pack(pack))

    brief = load_json(mission_dir / "content-brief.json")
    brief_version = {
        **brief,
        "status": "READY" if status == "RESEARCH_READY" else "EVIDENCE_INSUFFICIENT",
        "researchPackId": pack_id,
        "claims": claims,
        "updatedAt": isoformat(created_at),
        "parentBriefId": brief["briefId"],
        "briefId": f"{brief['briefId']}-{content_hash[:8]}",
    }
    atomic_write_json(mission_dir / f"content-brief-{content_hash[:8]}.json", brief_version)
    append_audit(
        "RESEARCH_PACK_CREATED",
        {
            "missionId": mission_id,
            "researchPackId": pack_id,
            "status": status,
            "contentHash": content_hash,
        },
    )
    return output_dir


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build and validate an AGT-RSN-004 local Research Pack."
    )
    parser.add_argument("--mission-id", required=True)
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    try:
        output = build_research_pack(args.mission_id, args.input)
    except (OSError, json.JSONDecodeError, IntelligenceError) as error:
        print(f"research_pack failed: {error}", file=sys.stderr)
        return 1
    print(str(output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

