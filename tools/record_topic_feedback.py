from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from approve_topic import find_topic
from intelligence_common import (
    INTELLIGENCE,
    IntelligenceError,
    append_audit,
    atomic_write_json,
    china_now,
    isoformat,
    safe_slug,
    sha256_value,
)


ALLOWED_DECISIONS = {"select", "reject", "defer", "rerank"}


def record_feedback(
    *,
    topic_id: str,
    decision: str,
    radar_id: str | None = None,
    reason_tags: list[str] | None = None,
    note: str | None = None,
    preferred_rank: int | None = None,
) -> Path:
    normalized = decision.lower()
    if normalized not in ALLOWED_DECISIONS:
        raise IntelligenceError(
            f"decision must be one of: {', '.join(sorted(ALLOWED_DECISIONS))}"
        )
    if preferred_rank is not None and preferred_rank < 1:
        raise IntelligenceError("preferred_rank must be a positive integer")
    pool, topic = find_topic(topic_id, radar_id)
    expected_hash = topic.get("snapshotHash")
    actual_hash = sha256_value(
        {key: value for key, value in topic.items() if key != "snapshotHash"}
    )
    if expected_hash != actual_hash:
        raise IntelligenceError(
            "Topic snapshot hash mismatch; refusing to record feedback"
        )
    now = china_now()
    normalized_tags = sorted(
        {
            str(tag).strip()
            for tag in (reason_tags or [])
            if str(tag).strip()
        }
    )
    feedback_seed: dict[str, Any] = {
        "topicId": topic_id,
        "radarId": pool["radarId"],
        "snapshotHash": actual_hash,
        "decision": normalized.upper(),
        "reasonTags": normalized_tags,
        "note": note or None,
        "preferredRank": preferred_rank,
    }
    feedback_id = f"FEEDBACK-{topic_id}-{sha256_value(feedback_seed)[:10]}"
    payload = {
        "schemaVersion": "1.0",
        "feedbackId": feedback_id,
        "recordedAt": isoformat(now),
        **feedback_seed,
        "trackAtDecision": topic.get("primaryTrack"),
        "topicValueAtDecision": topic.get("topicValueScore", topic.get("score")),
        "topicSnapshot": topic,
        "automaticWeightMutation": False,
    }
    output = (
        INTELLIGENCE
        / "preferences"
        / "feedback"
        / now.strftime("%Y-%m-%d")
        / f"{safe_slug(feedback_id, 'feedback')}.json"
    )
    if not output.exists():
        atomic_write_json(output, payload)
        append_audit(
            "TOPIC_PREFERENCE_FEEDBACK_RECORDED",
            {
                "feedbackId": feedback_id,
                "topicId": topic_id,
                "radarId": pool["radarId"],
                "decision": normalized.upper(),
                "automaticWeightMutation": False,
            },
        )
    return output


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Record explicit user topic preference feedback without automatically "
            "mutating scoring weights."
        )
    )
    parser.add_argument("--topic-id", required=True)
    parser.add_argument(
        "--decision",
        required=True,
        choices=tuple(sorted(ALLOWED_DECISIONS)),
    )
    parser.add_argument("--radar-id")
    parser.add_argument("--reason-tag", action="append", default=[])
    parser.add_argument("--note")
    parser.add_argument("--preferred-rank", type=int)
    args = parser.parse_args()
    try:
        output = record_feedback(
            topic_id=args.topic_id,
            decision=args.decision,
            radar_id=args.radar_id,
            reason_tags=args.reason_tag,
            note=args.note,
            preferred_rank=args.preferred_rank,
        )
    except (OSError, json.JSONDecodeError, IntelligenceError) as error:
        print(f"record_topic_feedback failed: {error}", file=sys.stderr)
        return 1
    print(str(output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
