from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REVIEW_NOTE_MARKER = "## 审阅说明（不属于正文）"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() == data:
            return
        raise FileExistsError(f"Immutable artifact already exists with different content: {path}")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    atomic_write(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def qualify_id(prefix: str, value: str) -> str:
    return value if len(value) >= 8 else f"{prefix}:{value}"


def public_body(review_copy: str) -> str:
    review_copy = review_copy.lstrip("\ufeff\r\n")
    if REVIEW_NOTE_MARKER not in review_copy:
        raise ValueError(f"Human review copy is missing marker: {REVIEW_NOTE_MARKER}")
    before, _ = review_copy.split(REVIEW_NOTE_MARKER, 1)
    before = re.sub(r"\n---\s*\n\s*$", "\n", before)
    body = before.rstrip() + "\n"
    if not body.startswith("# "):
        raise ValueError("Approved source body must begin with an H1 title")
    return body


def promote(args: argparse.Namespace) -> dict[str, Any]:
    repository = Path(args.repository).resolve()
    mission = (repository / args.mission_dir).resolve()
    if repository not in mission.parents:
        raise ValueError("Mission path escaped repository root")

    topic = args.topic_id
    topic_dir = mission / "drafts" / args.batch_id / topic / args.revision
    review_dir = mission / "review" / args.batch_id / args.revision
    human_copy_path = topic_dir / "human-review-copy.md"
    binding_path = topic_dir / "claim-binding.json"
    review_path = review_dir / f"{topic}-final-review.json"

    review = load_json(review_path)
    binding = load_json(binding_path)
    human_bytes = human_copy_path.read_bytes()
    human_hash = sha256_bytes(human_bytes)

    if review.get("reviewStatus") != "PASS":
        raise ValueError(f"Lilith review is not PASS for {topic}")
    recommendation = review.get("humanGateRecommendation") or {}
    if recommendation.get("gate") != "SOURCE_DRAFT_APPROVED":
        raise ValueError(f"Lilith did not recommend SOURCE_DRAFT_APPROVED for {topic}")
    if recommendation.get("artifactHash") != human_hash:
        raise ValueError(f"Human copy hash does not match final review for {topic}")
    if binding.get("topicId") != topic:
        raise ValueError(f"Claim binding topic mismatch for {topic}")
    if binding.get("draftHash") != review.get("sourceDraftHash"):
        raise ValueError(f"Claim binding draft hash does not match final review for {topic}")

    body = public_body(human_bytes.decode("utf-8"))
    body_hash = sha256_text(body)
    title = body.splitlines()[0][2:].strip()
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    topic_suffix = topic.rsplit("-", 1)[-1]
    run_id = f"RUN-{args.series_id}-{topic_suffix}"
    artifact_id = f"HUMAN-COPY-{topic}-R2"
    decision_id = f"HGD-SOURCE-{topic}-R2"
    version_id = f"CONTENT-VERSION-{topic}-V1"
    asset_id = f"CONTENT-ASSET-{topic}"

    decision = {
        "decisionId": decision_id,
        "organizationId": args.organization_id,
        "runId": run_id,
        "gate": "SOURCE_DRAFT_APPROVED",
        "artifactId": artifact_id,
        "artifactHash": human_hash,
        "decision": "APPROVED",
        "decidedBy": args.decided_by,
        "decidedAt": now,
        "notes": args.notes,
        "idempotencyKey": f"{args.series_id}:{topic}:SOURCE_DRAFT_APPROVED:{human_hash}",
    }

    claim_snapshot = []
    original_id_map: dict[str, dict[str, Any]] = {}
    for claim in binding.get("claims", []):
        original_claim_id = str(claim["claimId"])
        resolved_claim_id = qualify_id("claim", original_claim_id)
        original_evidence_ids = [str(item) for item in claim.get("evidenceIds", [])]
        resolved_evidence_ids = [qualify_id("evidence", item) for item in original_evidence_ids]
        claim_snapshot.append({
            "claimId": resolved_claim_id,
            "evidenceIds": resolved_evidence_ids,
            "statementHash": sha256_text(str(claim["statement"])),
        })
        original_id_map[resolved_claim_id] = {
            "originalClaimId": original_claim_id,
            "evidenceIdMap": dict(zip(resolved_evidence_ids, original_evidence_ids)),
        }

    version = {
        "id": version_id,
        "organizationId": args.organization_id,
        "createdBy": args.decided_by,
        "traceId": args.trace_id,
        "createdAt": now,
        "updatedAt": now,
        "status": "APPROVED",
        "assetId": asset_id,
        "versionNumber": 1,
        "title": title,
        "body": body,
        "contentHash": body_hash,
        "changeReason": "Enterprise human approved the Lilith-reviewed source draft for channel variants.",
        "changedBy": args.decided_by,
        "generationContextSnapshot": {
            "seriesId": args.series_id,
            "missionId": binding.get("missionId"),
            "topicId": topic,
            "sourceHumanReviewCopyHash": human_hash,
            "sourceDraftHash": review.get("sourceDraftHash"),
            "sourceReviewId": review.get("reviewId"),
            "knowledgeSnapshotHash": review.get("knowledgeSnapshotHash"),
            "humanGateDecisionId": decision_id,
            "claimBindingId": binding.get("bindingId"),
            "shortIdQualification": original_id_map,
        },
        "bodyFormat": "plain_text",
        "claimBindingSnapshot": claim_snapshot,
    }

    approved_dir = mission / "approved" / topic / "version-1"
    decision_path = mission / "audit" / "human-gates" / f"{decision_id}.json"
    version_path = approved_dir / "content-version.json"
    body_path = approved_dir / "content-version.md"
    ready_path = approved_dir / "READY"

    immutable_paths = [decision_path, version_path, body_path, ready_path]
    if all(path.exists() for path in immutable_paths):
        existing_decision = load_json(decision_path)
        existing_version = load_json(version_path)
        if (
            existing_decision.get("artifactHash") != human_hash
            or existing_decision.get("decision") != "APPROVED"
            or existing_version.get("contentHash") != body_hash
            or body_path.read_bytes() != body.encode("utf-8")
            or ready_path.read_text(encoding="utf-8").strip() != body_hash
        ):
            raise FileExistsError(f"Existing immutable promotion does not match current inputs for {topic}")
        return {
            "topicId": topic,
            "decisionId": existing_decision["decisionId"],
            "approvedArtifactHash": human_hash,
            "contentVersionId": existing_version["id"],
            "contentHash": body_hash,
            "claimCount": len(existing_version.get("claimBindingSnapshot", [])),
            "decisionPath": str(decision_path),
            "versionPath": str(version_path),
            "status": "APPROVED_FOR_VARIANTS",
            "idempotentReplay": True,
        }

    atomic_write_json(decision_path, decision)
    atomic_write(body_path, body.encode("utf-8"))
    atomic_write_json(version_path, version)
    atomic_write(ready_path, (body_hash + "\n").encode("utf-8"))

    return {
        "topicId": topic,
        "decisionId": decision_id,
        "approvedArtifactHash": human_hash,
        "contentVersionId": version_id,
        "contentHash": body_hash,
        "claimCount": len(claim_snapshot),
        "decisionPath": str(decision_path),
        "versionPath": str(version_path),
        "status": "APPROVED_FOR_VARIANTS",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Promote a Lilith-reviewed human copy into an immutable approved ContentVersion.")
    parser.add_argument("--repository", default=".")
    parser.add_argument("--mission-dir", required=True)
    parser.add_argument("--series-id", required=True)
    parser.add_argument("--batch-id", default="BATCH-01")
    parser.add_argument("--revision", default="revision-2")
    parser.add_argument("--topic-id", required=True)
    parser.add_argument("--organization-id", required=True)
    parser.add_argument("--trace-id", required=True)
    parser.add_argument("--decided-by", required=True)
    parser.add_argument("--notes", required=True)
    print(json.dumps(promote(parser.parse_args()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
