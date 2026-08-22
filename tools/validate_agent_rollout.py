#!/usr/bin/env python3
"""Fail closed when the V5.5.1 runtime registry, handlers and rollout diverge."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


EXPECTED = {
    "agt-004",
    "topic-radar",
    "public-researcher",
    "makabaka",
    "content-orchestrator",
    "lilith",
    "xiaodiandian",
    "balala",
}


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "agents" / "registry.v5.5.json").read_text(encoding="utf-8"))
    manifest_ids = {agent["agentId"] for agent in manifest["agents"]}
    runtime = (root / "packages" / "core" / "src" / "agent-runtime.ts").read_text(encoding="utf-8")
    contract = (root / "packages" / "contracts" / "src" / "collaboration.ts").read_text(encoding="utf-8")
    bootstrap = (root / "packages" / "core" / "src" / "v55-handlers.ts").read_text(encoding="utf-8")
    runtime_ids = set(re.findall(r'agentId:\s*"([a-z0-9-]+)"', runtime))
    contract_match = re.search(r"AgentIdSchema\s*=\s*z\.enum\(\[(.*?)\]\)", contract, re.S)
    contract_ids = set(re.findall(r'"([a-z0-9-]+)"', contract_match.group(1) if contract_match else ""))
    handler_ids = set(re.findall(r'registerHandler\("([a-z0-9-]+)"', bootstrap))
    errors = []
    for name, found in (("manifest", manifest_ids), ("runtime", runtime_ids), ("contract", contract_ids)):
        if found != EXPECTED:
            errors.append(f"{name} mismatch: missing={sorted(EXPECTED-found)} extra={sorted(found-EXPECTED)}")
    expected_handlers = EXPECTED - {"agt-004"}
    if handler_ids != expected_handlers:
        errors.append(f"handler mismatch: missing={sorted(expected_handlers-handler_ids)} extra={sorted(handler_ids-expected_handlers)}")
    for agent in manifest["agents"]:
        if agent["canApprove"]:
            errors.append(f"{agent['agentId']} illegally has approval permission")
        if agent["agentId"] != "agt-004" and agent["canWriteContentVersion"]:
            errors.append(f"{agent['agentId']} illegally has ContentVersion write permission")
        if agent["rolloutMode"] not in {"OFF", "SHADOW", "ENFORCING"}:
            errors.append(f"{agent['agentId']} has invalid rolloutMode")
        if agent["agentId"] == "agt-004" and agent["rolloutMode"] != "ENFORCING":
            errors.append("agt-004 supervisor must remain ENFORCING")
        if agent["agentId"] != "agt-004" and agent["rolloutMode"] == "ENFORCING":
            if not agent.get("rolloutApprovedBy") or not agent.get("rolloutApprovedAt"):
                errors.append(f"{agent['agentId']} is ENFORCING without versioned human rollout approval")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("V5.5.1 registry, runtime, handlers and safe rollout are aligned.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
