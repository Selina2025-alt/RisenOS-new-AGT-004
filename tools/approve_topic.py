from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from create_research_mission import create_mission
from intelligence_common import (
    INTELLIGENCE,
    ROOT,
    IntelligenceError,
    append_audit,
    atomic_write_json,
    china_now,
    isoformat,
    load_json,
    safe_slug,
    sha256_value,
)


def _topic_pool_paths() -> list[Path]:
    return sorted(
        INTELLIGENCE.glob("topic-radar/????-??-??/RADAR-*/topic-pool.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )


def find_topic(topic_id: str, radar_id: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    for path in _topic_pool_paths():
        pool = load_json(path)
        if radar_id and pool.get("radarId") != radar_id:
            continue
        for topic in pool.get("topics", []):
            if topic.get("topicId") == topic_id:
                return pool, topic
    raise IntelligenceError(f"Topic not found: {topic_id}")


def record_decision(
    *,
    topic_id: str,
    action: str,
    radar_id: str | None = None,
    audience: str | None = None,
    channel: str | None = None,
    goal: str | None = None,
) -> Path:
    if action not in {"approve", "reject"}:
        raise IntelligenceError("action must be approve or reject")
    pool, topic = find_topic(topic_id, radar_id)
    expected_hash = topic.get("snapshotHash")
    actual_hash = sha256_value({key: value for key, value in topic.items() if key != "snapshotHash"})
    if expected_hash != actual_hash:
        raise IntelligenceError("Topic snapshot hash mismatch; refusing to approve mutable data")

    decided_at = china_now()
    decision = {
        "schemaVersion": "1.0",
        "decisionId": f"DECISION-{topic_id}-{actual_hash[:8]}",
        "topicId": topic_id,
        "radarId": pool["radarId"],
        "action": action.upper(),
        "decidedAt": isoformat(decided_at),
        "topicSnapshot": topic,
        "snapshotHash": actual_hash,
    }
    decision_dir = ROOT / "approved" / "topics" / safe_slug(topic_id, "topic")
    decision_path = decision_dir / f"{action}-{actual_hash[:12]}.json"
    if not decision_path.exists():
        atomic_write_json(decision_path, decision)

    if action == "approve":
        mission_dir = create_mission(
            topic=topic["title"],
            audience=audience or topic.get("targetAudience"),
            channel=channel,
            goal=goal or topic.get("angle"),
            origin_topic=topic,
        )
        append_audit(
            "TOPIC_APPROVED",
            {
                "topicId": topic_id,
                "radarId": pool["radarId"],
                "snapshotHash": actual_hash,
                "missionPath": str(mission_dir.relative_to(ROOT)).replace("\\", "/"),
            },
        )
        return mission_dir

    append_audit(
        "TOPIC_REJECTED",
        {
            "topicId": topic_id,
            "radarId": pool["radarId"],
            "snapshotHash": actual_hash,
        },
    )
    return decision_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Approve or reject an immutable AGT-RSN-004 topic snapshot."
    )
    parser.add_argument("--topic-id", required=True)
    parser.add_argument("--action", required=True, choices=("approve", "reject"))
    parser.add_argument("--radar-id")
    parser.add_argument("--audience")
    parser.add_argument("--channel")
    parser.add_argument("--goal")
    args = parser.parse_args()
    try:
        output = record_decision(
            topic_id=args.topic_id,
            action=args.action,
            radar_id=args.radar_id,
            audience=args.audience,
            channel=args.channel,
            goal=args.goal,
        )
    except (OSError, json.JSONDecodeError, IntelligenceError) as error:
        print(f"approve_topic failed: {error}", file=sys.stderr)
        return 1
    print(str(output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

