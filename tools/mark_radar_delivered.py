from __future__ import annotations

import argparse
import json
import sys

from intelligence_common import (
    INTELLIGENCE,
    IntelligenceError,
    append_audit,
    atomic_write_json,
    isoformat,
    load_json,
)


def mark_delivered(radar_id: str) -> bool:
    latest_path = INTELLIGENCE / "topic-radar" / "latest.json"
    if not latest_path.exists():
        raise IntelligenceError("No latest radar exists")
    latest = load_json(latest_path)
    if latest.get("radarId") != radar_id:
        raise IntelligenceError(
            f"Radar mismatch: latest is {latest.get('radarId')}, requested {radar_id}"
        )
    pool_path = INTELLIGENCE / latest["topicPool"]
    state_path = pool_path.parent / "delivery-state.json"
    state = load_json(state_path)
    if state.get("threadDelivered"):
        return False
    if state.get("inputHash") != latest.get("inputHash"):
        raise IntelligenceError("Delivery state input hash mismatch")
    state["threadDelivered"] = True
    state["deliveredAt"] = isoformat()
    atomic_write_json(state_path, state)
    append_audit(
        "TOPIC_RADAR_DELIVERED",
        {
            "radarId": radar_id,
            "inputHash": state["inputHash"],
            "destination": "current-codex-thread",
        },
    )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Mark a topic radar as delivered to this thread.")
    parser.add_argument("--radar-id", required=True)
    args = parser.parse_args()
    try:
        changed = mark_delivered(args.radar_id)
    except (OSError, json.JSONDecodeError, IntelligenceError) as error:
        print(f"mark_radar_delivered failed: {error}", file=sys.stderr)
        return 1
    print("marked" if changed else "already-delivered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

