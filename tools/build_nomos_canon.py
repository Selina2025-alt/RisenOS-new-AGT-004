#!/usr/bin/env python3
"""Build the active Nomos bundle from pre-classified cards.

Activation is explicit. The command never changes source cards; it writes an
immutable activation manifest containing only approved, public-usable cards.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def atomic_write(path: Path, value: object) -> None:
    payload = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-by", required=True, help="Enterprise human approver ID")
    args = parser.parse_args()
    if len(args.approved_by) < 8:
        print("Approver ID must be an explicit enterprise identity", file=sys.stderr)
        return 1
    root = Path(__file__).resolve().parents[1]
    canon = root / "knowledge" / "canon" / "nomos-canon-20260820-v1.0.0"
    claims_path = canon / "claim-cards.json"
    claims = json.loads(claims_path.read_text(encoding="utf-8"))
    active = [claim["claimId"] for claim in claims if claim["status"] == "ACTIVE" and claim["publicationDisposition"] == "PUBLIC_SAFE" and claim.get("approvedBy")]
    if not active:
        print("No human-approved public-safe claims are available", file=sys.stderr)
        return 1
    source_manifest = root / "knowledge" / "sources" / "ingested" / "nomos-canon-20260820-v1.0.0" / "source_manifest.json"
    source_hash = hashlib.sha256(source_manifest.read_bytes()).hexdigest()
    claim_hash = hashlib.sha256(claims_path.read_bytes()).hexdigest()
    activation = {
        "schemaVersion": "1.0.0",
        "bundleId": "nomos-canon-20260820-v1.0.0",
        "status": "ACTIVE",
        "approvedBy": args.approved_by,
        "approvedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceManifestHash": source_hash,
        "claimCardsHash": claim_hash,
        "activeClaimIds": active,
        "excludedClaimIds": [claim["claimId"] for claim in claims if claim["claimId"] not in active],
        "automaticActivation": False,
    }
    atomic_write(canon / "ACTIVE_MANIFEST.json", activation)
    print(json.dumps(activation, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
