#!/usr/bin/env python3
"""Render a human-readable review copy from an internal DraftProposal.

The renderer is deterministic: it removes YAML frontmatter, internal Claim tags,
and the internal status block while preserving the article and public sources.
It never changes the source DraftProposal.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path


CLAIM_TAG = re.compile(r"\[(?:EXT|ENT|S\d+|PUB|PROD|ICB)-[A-Z0-9-]+\]")
STATUS_BLOCK = re.compile(
    r"\n?> 状态说明：本文为.*?不得视为正式对外版本。\s*$", re.DOTALL
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def strip_frontmatter(text: str) -> str:
    match = re.match(r"\A---\r?\n.*?\r?\n---\r?\n", text, re.DOTALL)
    return text[match.end() :] if match else text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--draft", required=True)
    parser.add_argument("--binding", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    draft_path = Path(args.draft).resolve()
    binding_path = Path(args.binding).resolve()
    output_path = Path(args.output).resolve()

    raw = draft_path.read_text(encoding="utf-8")
    draft_hash = sha256(raw.encode("utf-8"))
    binding = json.loads(binding_path.read_text(encoding="utf-8"))
    if binding.get("draftHash") != draft_hash:
        raise ValueError("claim-binding draftHash does not match DraftProposal")

    body = strip_frontmatter(raw)
    body = STATUS_BLOCK.sub("", body)
    body = CLAIM_TAG.sub("", body).rstrip()

    note = (
        "\n\n---\n\n"
        "## 审阅说明（不属于正文）\n\n"
        f"- 本净稿对应内部 DraftProposal SHA-256：`{draft_hash}`。\n"
        "- 正文中的内部 Claim 编号和运行状态已移除；公开资料链接保留在“公开来源”。\n"
        "- 企业、产品和数据口径已绑定知识快照与 Claim/Evidence，具体映射保存在同目录 `claim-binding.json`。\n"
        "- 当前仍是人工审阅稿，不代表已批准发布。\n"
    )
    rendered = body + note

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    tmp_path.write_text(rendered, encoding="utf-8", newline="\n")
    tmp_path.replace(output_path)
    print(json.dumps({
        "draftHash": draft_hash,
        "reviewCopyHash": sha256(rendered.encode("utf-8")),
        "output": str(output_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
