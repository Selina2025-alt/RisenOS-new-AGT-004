from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

from feed_writer import write_feed_run
from intelligence_common import IntelligenceError, china_now, isoformat


DEFAULT_SCRIPT = Path(
    r"C:\Users\Administrator\.codex\skills\follow-builders\scripts\prepare-digest.js"
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the existing Follow Builders collector and safely ingest its JSON."
    )
    parser.add_argument("--node", default="node")
    parser.add_argument("--script", type=Path, default=DEFAULT_SCRIPT)
    parser.add_argument("--digest", type=Path)
    parser.add_argument(
        "--emit-json",
        action="store_true",
        help="Emit the original prepare-digest JSON with the local feed path added.",
    )
    args = parser.parse_args()
    now = china_now()
    try:
        completed = subprocess.run(
            [args.node, str(args.script)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        payload = json.loads(completed.stdout)
        digest = args.digest.read_text(encoding="utf-8") if args.digest else None
        output = write_feed_run(
            feed_id="follow-builders",
            payload=payload,
            window_start=isoformat(now - timedelta(hours=24)),
            window_end=isoformat(now),
            collected_at=isoformat(now),
            digest_text=digest,
        )
    except (
        OSError,
        subprocess.SubprocessError,
        json.JSONDecodeError,
        IntelligenceError,
    ) as error:
        print(f"run_follow_builders_ingest failed: {error}", file=sys.stderr)
        return 1
    if args.emit_json:
        payload["agt004FeedPath"] = str(output.resolve())
        payload["agt004FeedStatus"] = "SUCCESS"
        print(json.dumps(payload, ensure_ascii=False))
    else:
        print(str(output.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
