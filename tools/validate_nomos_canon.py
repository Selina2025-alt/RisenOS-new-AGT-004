#!/usr/bin/env python3
"""Validate Nomos candidate canon and prevent unsafe activation."""

from __future__ import annotations

import json
import hashlib
import sys
from pathlib import Path


ACTIVE_ALLOWED = {"PUBLIC_CONFIRMED", "PRODUCT_DEMONSTRATED", "RD_CONFIRMED", "STRATEGIC_VIEW"}


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    canon = root / "knowledge" / "canon" / "nomos-canon-20260820-v1.0.0"
    claims = json.loads((canon / "claim-cards.json").read_text(encoding="utf-8"))
    conflicts = json.loads((canon / "conflicts.json").read_text(encoding="utf-8"))
    active_manifest = json.loads((canon / "ACTIVE_MANIFEST.json").read_text(encoding="utf-8"))
    ingest = json.loads((root / "knowledge" / "sources" / "ingested" / "nomos-canon-20260820-v1.0.0" / "INGESTION_REPORT.json").read_text(encoding="utf-8"))
    errors: list[str] = []
    ids: set[str] = set()
    for claim in claims:
        claim_id = claim.get("claimId")
        if not claim_id or claim_id in ids:
            errors.append(f"Duplicate or missing claimId: {claim_id}")
        ids.add(claim_id)
        if claim.get("status") == "ACTIVE" and claim.get("claimClass") not in ACTIVE_ALLOWED:
            errors.append(f"Unsafe active claim class: {claim_id}")
        if claim.get("claimClass") == "STRATEGIC_VIEW" and not claim.get("publicSafeWording"):
            errors.append(f"Strategic claim lacks attributed public wording: {claim_id}")
        if claim.get("publicationDisposition") == "PUBLIC_SAFE" and not claim.get("evidenceRefs"):
            errors.append(f"Public claim lacks evidence: {claim_id}")
    for conflict in conflicts:
        if any(claim_id not in ids for claim_id in conflict.get("claimCardIds", [])):
            errors.append(f"Conflict references unknown claim: {conflict.get('conflictId')}")
    claims_by_id = {claim["claimId"]: claim for claim in claims if claim.get("claimId")}
    active_ids = set(active_manifest.get("activeClaimIds", []))
    excluded_ids = set(active_manifest.get("excludedClaimIds", []))
    if active_manifest.get("status") != "ACTIVE" or not active_manifest.get("approvedBy"):
        errors.append("Active manifest is not explicitly approved")
    if active_ids & excluded_ids:
        errors.append("Active and excluded claim sets overlap")
    if (active_ids | excluded_ids) - ids:
        errors.append("Active manifest references unknown claim IDs")
    for claim_id in active_ids:
        claim = claims_by_id[claim_id]
        if claim.get("status") != "ACTIVE" or claim.get("claimClass") not in ACTIVE_ALLOWED:
            errors.append(f"Active manifest includes unsafe claim: {claim_id}")
    claims_hash = hashlib.sha256((canon / "claim-cards.json").read_bytes()).hexdigest()
    if active_manifest.get("claimCardsHash") != claims_hash:
        errors.append("Active manifest claimCardsHash does not match claim-cards.json")
    if not ingest.get("allSourcesComplete") or not ingest.get("allSecurityScansPassed"):
        errors.append("Raw source ingestion is incomplete or failed its security scan")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(
        f"Nomos canon valid and explicitly activated: {len(active_ids)} active claims, "
        f"{len(excluded_ids)} excluded claims, {len(conflicts)} conflict records."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
