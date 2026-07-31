from __future__ import annotations

import tempfile
import re
from pathlib import Path

from markdown_to_docx import convert


ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE = ROOT / "knowledge"
SOURCES = [
    KNOWLEDGE / "01_企业品牌与产品总览.md",
    KNOWLEDGE / "02_目标客户与使用场景.md",
    KNOWLEDGE / "03_品牌语气与内容表达.md",
    KNOWLEDGE / "products" / "两条产品线与五级架构_V2.0.md",
    KNOWLEDGE / "products" / "核心产品口径_两条产品线四大矩阵_V3.0.md",
    KNOWLEDGE / "clients" / "目标客户_八大场景与商业模式_V2.0.md",
    KNOWLEDGE / "clients" / "官网六大场景与九大商业模式_正式口径_V3.0.md",
    KNOWLEDGE / "clients" / "官网八大核心场景与九大商业模式_线上正式口径_V4.0.md",
    KNOWLEDGE / "agents" / "官网公开智能体名单_20260730.md",
    KNOWLEDGE / "brand" / "企业品牌与官网叙事_202607.md",
    KNOWLEDGE / "compliance" / "艾氪智能禁用表达与内容合规规范_V1.0.md",
    KNOWLEDGE / "evidence" / "产品能力_案例与公开证据台账.md",
    KNOWLEDGE / "evidence" / "新增Claim与案例证据闸门_202607.md",
    KNOWLEDGE / "evidence" / "ICB核心事实卡_V3.0.md",
    KNOWLEDGE / "policy" / "智能体政策背书与引用规范_2025-2026.md",
    KNOWLEDGE / "content" / "历史内容与可复用表达.md",
    KNOWLEDGE / "content" / "全员大会演讲叙事素材_内部版.md",
    KNOWLEDGE / "channels" / "渠道内容格式偏好_暂行版.md",
    KNOWLEDGE / "visual" / "品牌视觉规范_资料缺口.md",
    KNOWLEDGE / "visual" / "官网视觉与信息架构_202607.md",
    KNOWLEDGE / "visual" / "官网视觉观察_20260730.md",
    KNOWLEDGE / "competitive" / "竞品与参考内容库_内部版.md",
    KNOWLEDGE / "competitive" / "全球领先性研究使用边界_202607.md",
    KNOWLEDGE / "security" / "内容分级与保密规则.md",
    KNOWLEDGE / "sources" / "版本冲突与公开风险清单_202607.md",
    KNOWLEDGE / "sources" / "官网在线核验快照_20260730.md",
    KNOWLEDGE / "知识库完整性报告_V4.0.md",
    KNOWLEDGE / "sources" / "十一份资料来源登记.md",
]
TARGET = ROOT / "exports" / "艾氪智能企业品牌产品内容知识库_V4.0_内部版.docx"


def main() -> None:
    missing = [str(path) for path in SOURCES if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing knowledge files: {missing}")
    parts = [
        "# 艾氪智能企业品牌产品内容知识库 V4.0（内部版）",
        "",
        "> 生成日期：2026-07-30",
        "> 用途：独立 AGT-RSN-004 本地内容生成与企业内部审核",
        "> 分级：INTERNAL_ONLY",
        "",
    ]
    for source in SOURCES:
        content = source.read_text(encoding="utf-8").strip()
        content = re.sub(
            r"^(#{1,3})\s",
            lambda match: f"{match.group(1)}# ",
            content,
            flags=re.MULTILINE,
        )
        parts.extend([content, "", "---", ""])
    with tempfile.TemporaryDirectory() as directory:
        merged = Path(directory) / "knowledge-pack.md"
        merged.write_text("\n".join(parts), encoding="utf-8")
        convert(merged, TARGET)
    print(TARGET)


if __name__ == "__main__":
    main()
