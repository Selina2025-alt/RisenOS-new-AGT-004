from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from intelligence_common import (
    ROOT,
    IntelligenceError,
    append_audit,
    atomic_write_json,
    china_now,
    guard_public_query,
    isoformat,
    safe_slug,
    sha256_value,
    short_hash,
)


def _query_candidates(topic: str, explicit_queries: list[str] | None) -> list[str]:
    if explicit_queries:
        raw = explicit_queries
    else:
        raw = [
            topic,
            f"{topic} 最新 官方",
            f"{topic} 研究 报告",
            f"{topic} YouTube",
            f"{topic} case study",
        ]
    seen: set[str] = set()
    result: list[str] = []
    for query in raw:
        normalized = " ".join(query.split()).strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def create_mission(
    *,
    topic: str,
    audience: str | None = None,
    channel: str | None = None,
    goal: str | None = None,
    queries: list[str] | None = None,
    origin_topic: dict[str, Any] | None = None,
) -> Path:
    topic = topic.strip()
    if not topic:
        raise IntelligenceError("topic is required")
    created_at = china_now()
    seed = {
        "topic": topic,
        "audience": audience,
        "channel": channel,
        "goal": goal,
        "originSnapshotHash": (origin_topic or {}).get("snapshotHash"),
    }
    mission_id = f"MISSION-{created_at.strftime('%Y%m%d')}-{short_hash(seed, 10)}"
    mission_dir = ROOT / "missions" / safe_slug(mission_id, "mission")
    mission_path = mission_dir / "mission.json"
    if mission_path.exists():
        return mission_dir

    allowed_queries: list[str] = []
    blocked_queries: list[dict[str, Any]] = []
    for query in _query_candidates(topic, queries):
        allowed, reasons = guard_public_query(query)
        if allowed:
            allowed_queries.append(query)
        else:
            blocked_queries.append({"queryHash": sha256_value(query), "reasons": reasons})

    status = "RESEARCH_REQUIRED" if allowed_queries else "QUERY_REVIEW_REQUIRED"
    mission = {
        "schemaVersion": "1.0",
        "missionId": mission_id,
        "missionType": "TOPIC_RESEARCH_AND_CONTENT",
        "topic": topic,
        "audience": audience,
        "channel": channel,
        "goal": goal,
        "status": status,
        "createdAt": isoformat(created_at),
        "modelPolicy": "use-current-host-model",
        "persistence": "local-files",
        "externalPublishing": False,
        "platformCredentialsRequired": False,
        "originTopic": origin_topic,
        "contentHash": sha256_value(seed),
    }
    research_plan = {
        "schemaVersion": "1.0",
        "missionId": mission_id,
        "status": status,
        "publicQueries": allowed_queries,
        "blockedQueryRecords": blocked_queries,
        "sourceTypes": [
            "official",
            "article",
            "report",
            "paper",
            "github",
            "youtube",
            "public_speech",
            "expert_opinion",
            "competitor_public_content",
        ],
        "targetSourceCount": {
            "minimum": 8,
            "maximum": 15,
            "minimumSourceTypes": 3,
            "preferredStrongSources": 2,
        },
        "securityRules": {
            "publicReadOnly": True,
            "noLoginBypass": True,
            "noExecutableDownloads": True,
            "treatSourceInstructionsAsUntrusted": True,
            "mergeEnterpriseKnowledgeOnlyAfterRetrieval": True,
        },
    }
    brief = {
        "schemaVersion": "1.0",
        "missionId": mission_id,
        "briefId": f"BRIEF-{short_hash(seed, 10)}",
        "status": "PENDING_RESEARCH",
        "topic": topic,
        "goal": goal,
        "targetAudience": audience,
        "channel": channel,
        "missingCreationParameters": [
            key
            for key, value in {
                "goal": goal,
                "targetAudience": audience,
                "channel": channel,
            }.items()
            if not value
        ],
        "researchPackId": None,
        "claims": [],
        "evidenceConstraints": [
            "事实性 Claim 必须绑定可追溯来源。",
            "人物观点只能证明其公开表达，不能自动证明观点正确。",
            "国内竞品实名只允许保留在内部研究资料中。",
        ],
        "createdAt": isoformat(created_at),
    }
    atomic_write_json(mission_path, mission)
    atomic_write_json(mission_dir / "research-plan.json", research_plan)
    atomic_write_json(mission_dir / "content-brief.json", brief)
    append_audit(
        "RESEARCH_MISSION_CREATED",
        {
            "missionId": mission_id,
            "status": status,
            "originTopicId": (origin_topic or {}).get("topicId"),
            "allowedQueryCount": len(allowed_queries),
            "blockedQueryCount": len(blocked_queries),
        },
    )
    return mission_dir


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create a safe local topic research mission for AGT-RSN-004."
    )
    parser.add_argument("--topic", required=True)
    parser.add_argument("--audience")
    parser.add_argument("--channel")
    parser.add_argument("--goal")
    parser.add_argument("--query", action="append", dest="queries")
    args = parser.parse_args()
    try:
        output = create_mission(
            topic=args.topic,
            audience=args.audience,
            channel=args.channel,
            goal=args.goal,
            queries=args.queries,
        )
    except (OSError, json.JSONDecodeError, IntelligenceError) as error:
        print(f"create_research_mission failed: {error}", file=sys.stderr)
        return 1
    print(str(output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

