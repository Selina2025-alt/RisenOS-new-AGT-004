from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from intelligence_common import INTELLIGENCE, ROOT, canonicalize_url, guard_public_query, load_config


REQUIRED_TOOLS = (
    "intelligence_common.py",
    "feed_writer.py",
    "build_daily_radar.py",
    "create_research_mission.py",
    "approve_topic.py",
    "record_topic_feedback.py",
    "research_pack.py",
    "mark_radar_delivered.py",
    "run_follow_builders_ingest.py",
)

REQUIRED_SCHEMAS = (
    "feed-run.schema.json",
    "signal-item.schema.json",
    "topic-candidate.schema.json",
    "research-pack.schema.json",
)

FORBIDDEN_DOMAIN_FIELDS = {
    "platformAccount",
    "publishAt",
    "publishTask",
    "publishStatus",
    "platformToken",
    "learningProposal",
    "effectMetrics",
}


def validate() -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    for name in REQUIRED_TOOLS:
        if not (ROOT / "tools" / name).exists():
            errors.append(f"Missing tool: {name}")
    for name in REQUIRED_SCHEMAS:
        path = INTELLIGENCE / "schemas" / name
        if not path.exists():
            errors.append(f"Missing schema: {name}")
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            errors.append(f"Invalid schema JSON {name}: {error}")

    scoring = load_config("scoring-policy.json")
    if scoring.get("scoringMode") != "track-aware-v3":
        errors.append("Scoring mode must be track-aware-v3")
    expected_tracks = {"HOT_EVENT", "PUBLIC_VOICE", "ENTERPRISE_AI"}
    tracks = scoring.get("tracks", {})
    if set(tracks) != expected_tracks:
        errors.append("Scoring policy must define exactly three topic tracks")
    for track, policy in tracks.items():
        if sum(policy.get("weights", {}).values()) != 100:
            errors.append(f"Scoring weights for {track} must total 100")
    preference = scoring.get("preferencePolicy", {})
    if preference.get("automaticWeightMutation") is not False:
        errors.append("Topic preference weights must not mutate automatically")
    if scoring.get("dailyCandidateMinimum") != 5:
        errors.append("dailyCandidateMinimum must be 5")
    if scoring.get("dailyCandidateMaximum") != 8:
        errors.append("dailyCandidateMaximum must be 8")

    context_path = ROOT / "active_context.json"
    context = json.loads(context_path.read_text(encoding="utf-8"))
    if context.get("modelPolicy") != "use-current-host-model":
        errors.append("active_context must use the current host model")
    if context.get("externalPublishing") is not False:
        errors.append("externalPublishing must remain false")
    if context.get("databaseRequired") is not False:
        errors.append("databaseRequired must remain false")
    if context.get("frontendRequired") is not False:
        errors.append("frontendRequired must remain false")
    for name, relative in context.get("intelligencePaths", {}).items():
        target = ROOT / relative
        if name in {"inbox", "research"}:
            continue
        if not target.exists():
            errors.append(f"Missing active intelligence path {name}: {relative}")

    schema_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (INTELLIGENCE / "schemas").glob("*.json")
    )
    for field in FORBIDDEN_DOMAIN_FIELDS:
        if re.search(rf'"{re.escape(field)}"', schema_text, flags=re.IGNORECASE):
            errors.append(f"Forbidden publishing/effect field present in schema: {field}")

    for unsafe in ("file:///C:/secret", "http://127.0.0.1/", "http://10.0.0.1/"):
        _, status = canonicalize_url(unsafe)
        if status != "rejected":
            errors.append(f"Unsafe URL was not rejected: {unsafe}")
    allowed, _ = guard_public_query("企业智能体 最新政策")
    blocked, _ = guard_public_query("内部版 未公开路线图")
    if not allowed or blocked:
        errors.append("Public query guard is not enforcing the expected boundary")

    inbox = INTELLIGENCE / "inbox"
    if inbox.exists():
        incomplete = [
            path
            for path in inbox.glob("*/*/*")
            if path.is_dir() and not (path / "READY").exists()
        ]
        if incomplete:
            warnings.append(f"{len(incomplete)} incomplete feed run(s) are correctly ignored")

    return {
        "status": "PASS" if not errors else "FAIL",
        "errors": errors,
        "warnings": warnings,
        "checkedTools": len(REQUIRED_TOOLS),
        "checkedSchemas": len(REQUIRED_SCHEMAS),
    }


def main() -> int:
    result = validate()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
