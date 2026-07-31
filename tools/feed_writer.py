from __future__ import annotations

import argparse
import json
import sys
from datetime import timedelta
from pathlib import Path
from typing import Any

from intelligence_common import (
    CHINA_TZ,
    INTELLIGENCE,
    IntelligenceError,
    atomic_write_json,
    atomic_write_text,
    china_now,
    flatten_candidate_items,
    isoformat,
    load_json,
    normalize_signal_item,
    parse_datetime,
    redact_sensitive_text,
    safe_slug,
    sha256_value,
    validate_feed_run,
)


FEED_IDS = ("aihot", "agentreach", "follow-builders")


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        key = item["canonicalUrl"] or f"{item['sourceName'].lower()}|{item['title'].lower()}"
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _extract_errors(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []
    raw_errors = payload.get("errors", [])
    if not isinstance(raw_errors, list):
        raw_errors = [raw_errors]
    return [redact_sensitive_text(error)[:500] for error in raw_errors if str(error).strip()]


def _render_digest(feed_id: str, run: dict[str, Any]) -> str:
    lines = [
        f"# {feed_id} 本地资讯副本",
        "",
        f"- Run ID：`{run['runId']}`",
        f"- 时间窗：{run['windowStart']} — {run['windowEnd']}",
        f"- 状态：{run['status']}",
        f"- 条目数：{len(run['items'])}",
        "",
        "## 条目",
        "",
    ]
    for item in run["items"]:
        when = item["publishedAt"] or "发布时间未明确"
        link = item["canonicalUrl"] or "无可追溯链接"
        lines.extend(
            [
                f"### {item['title']}",
                "",
                f"- 来源：{item['sourceName']}",
                f"- 时间：{when}",
                f"- 链接：{link}",
                f"- 摘要：{item['summary'] or '未提供摘要'}",
                "",
            ]
        )
    if run["errors"]:
        lines.extend(["## 采集告警", ""])
        lines.extend(f"- {error}" for error in run["errors"])
        lines.append("")
    return "\n".join(lines)


def write_feed_run(
    *,
    feed_id: str,
    payload: Any,
    window_start: str | None,
    window_end: str | None,
    collected_at: str | None,
    digest_text: str | None,
) -> Path:
    if feed_id not in FEED_IDS:
        raise IntelligenceError(f"Unsupported feed id: {feed_id}")

    collected = parse_datetime(collected_at) if collected_at else None
    collected = collected or china_now()
    discovered_at = isoformat(collected)
    end = parse_datetime(window_end) if window_end else collected
    start = parse_datetime(window_start) if window_start else end - timedelta(hours=24)
    if not start or not end:
        raise IntelligenceError("windowStart/windowEnd must be valid date-times")
    if start >= end:
        raise IntelligenceError("windowStart must be before windowEnd")

    raw_items = flatten_candidate_items(payload)
    normalized = [
        item
        for raw in raw_items
        if (item := normalize_signal_item(raw, feed_id, discovered_at)) is not None
    ]
    normalized = _dedupe(normalized)
    errors = _extract_errors(payload)
    rejected_count = sum(1 for item in normalized if item["verificationStatus"] == "rejected")
    if rejected_count:
        errors.append(f"{rejected_count} item(s) contained unsafe URLs and were retained without a URL")
        for item in normalized:
            if item["verificationStatus"] == "rejected":
                item["url"] = ""
                item["canonicalUrl"] = ""

    status = "SUCCESS"
    if not normalized:
        status = "EMPTY"
    elif errors:
        status = "DEGRADED"

    input_hash = sha256_value(
        {
            "feedId": feed_id,
            "windowStart": isoformat(start),
            "windowEnd": isoformat(end),
            "items": normalized,
        }
    )
    local_date = collected.astimezone(CHINA_TZ).strftime("%Y-%m-%d")
    run_id = safe_slug(
        f"{feed_id}-{collected.astimezone(CHINA_TZ).strftime('%Y%m%dT%H%M%S')}-{input_hash[:8].lower()}",
        "feed-run",
    )
    run = {
        "schemaVersion": "1.0",
        "feedId": feed_id,
        "runId": run_id,
        "windowStart": isoformat(start),
        "windowEnd": isoformat(end),
        "collectedAt": isoformat(collected),
        "status": status,
        "errors": errors,
        "items": normalized,
        "inputHash": input_hash,
    }
    validation_errors = validate_feed_run(run)
    if validation_errors:
        raise IntelligenceError("; ".join(validation_errors))

    run_dir = INTELLIGENCE / "inbox" / feed_id / local_date / run_id
    ready = run_dir / "READY"
    if ready.exists():
        return run_dir
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        key: value
        for key, value in run.items()
        if key != "items"
    }
    manifest["itemCount"] = len(normalized)
    atomic_write_json(run_dir / "manifest.json", manifest)
    atomic_write_json(run_dir / "items.json", normalized)
    safe_digest = redact_sensitive_text(digest_text) if digest_text else _render_digest(feed_id, run)
    atomic_write_text(run_dir / "digest.md", safe_digest.rstrip() + "\n")
    atomic_write_text(ready, input_hash + "\n")
    return run_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate and atomically write an AGT-RSN-004 local feed run."
    )
    parser.add_argument("--feed-id", required=True, choices=FEED_IDS)
    parser.add_argument(
        "--input",
        required=True,
        type=Path,
        help="JSON file containing items, or '-' to read JSON from stdin",
    )
    parser.add_argument("--digest", type=Path, help="Optional Markdown digest")
    parser.add_argument("--window-start")
    parser.add_argument("--window-end")
    parser.add_argument("--collected-at")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        payload = json.load(sys.stdin) if str(args.input) == "-" else load_json(args.input)
        digest = args.digest.read_text(encoding="utf-8") if args.digest else None
        output = write_feed_run(
            feed_id=args.feed_id,
            payload=payload,
            window_start=args.window_start,
            window_end=args.window_end,
            collected_at=args.collected_at,
            digest_text=digest,
        )
    except (OSError, json.JSONDecodeError, IntelligenceError) as error:
        print(f"feed_writer failed: {error}", file=sys.stderr)
        return 1
    print(str(output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
