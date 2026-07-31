from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime
from pathlib import Path


WORKSPACE = Path(r"D:\company project\瑞森宣发智能体家族\RisenOS（新版）\AGT-RSN-004-Workspace")
KNOWLEDGE = WORKSPACE / "knowledge"
INGESTED = KNOWLEDGE / "sources" / "ingested"

TOPIC_TARGETS = {
    "企业战略": KNOWLEDGE / "strategy" / "来源章节索引_企业战略.md",
    "品牌定位": KNOWLEDGE / "brand" / "来源章节索引_品牌定位.md",
    "产品与架构": KNOWLEDGE / "products" / "来源章节索引_产品与架构.md",
    "智能体能力": KNOWLEDGE / "agents" / "来源章节索引_智能体能力.md",
    "客户与场景": KNOWLEDGE / "clients" / "来源章节索引_客户与场景.md",
    "案例与证据": KNOWLEDGE / "evidence" / "来源章节索引_案例与证据.md",
    "官网与视觉": KNOWLEDGE / "visual" / "来源章节索引_官网与视觉.md",
    "历史内容": KNOWLEDGE / "content" / "来源章节索引_历史内容.md",
    "竞品与壁垒": KNOWLEDGE / "competitive" / "来源章节索引_竞品与壁垒.md",
    "合规与保密": KNOWLEDGE / "security" / "来源章节索引_合规与保密.md",
}

SOURCE_DEFAULTS = {
    "SRC-20260716-ALLHANDS": ("历史内容", ["品牌定位", "企业战略"]),
    "SRC-20260718-COMPANY-PRODUCT": ("产品与架构", ["企业战略", "品牌定位", "客户与场景"]),
    "SRC-202607-WEBSITE": ("官网与视觉", ["品牌定位"]),
    "SRC-V8-AGENTIC-OS": ("企业战略", []),
    "SRC-V7-GROUP-STRATEGY": ("企业战略", []),
    "SRC-20260724-LEADERSHIP-REPORT": ("竞品与壁垒", []),
}


def relative_link(from_file: Path, to_file: Path) -> str:
    return Path(os.path.relpath(to_file, start=from_file.parent)).as_posix()


def selected_topics(source_id: str, scores: dict[str, int]) -> tuple[str, list[str]]:
    default_primary, default_cross = SOURCE_DEFAULTS[source_id]
    if not scores:
        return default_primary, [default_primary]
    ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    score_primary, maximum = ordered[0]
    primary = default_primary
    if score_primary in ("案例与证据", "合规与保密", "官网与视觉", "历史内容"):
        primary = score_primary
    selected = [
        topic
        for topic, score in ordered
        if score >= 2 and score >= maximum * 0.35
    ][:4]
    selected = [primary, *default_cross, *selected]
    selected = list(dict.fromkeys(selected))[:5]
    if primary not in selected:
        selected.insert(0, primary)
    return primary, selected


def main() -> None:
    routes: dict[str, list[dict]] = defaultdict(list)
    coverage = []
    source_manifests = sorted(INGESTED.glob("*/source_manifest.json"))
    for manifest_file in source_manifests:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        source_dir = manifest_file.parent
        for section in manifest["section_index"]:
            primary, topics = selected_topics(manifest["source_id"], section.get("topics", {}))
            record = {
                "source_id": manifest["source_id"],
                "source_file": manifest["source_file"],
                "title": section["title"],
                "source_range": f"{section['start_locator']}-{section['end_locator']}",
                "char_count": section["char_count"],
                "primary_topic": primary,
                "topics": topics,
                "scores": section.get("topics", {}),
                "section_path": str((source_dir / section["file"]).resolve()),
            }
            coverage.append(record)
            for topic in topics:
                routes[topic].append(record)

    for topic, target in TOPIC_TARGETS.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        records = routes.get(topic, [])
        primary_count = sum(record["primary_topic"] == topic for record in records)
        lines = [
            f"# 来源章节索引：{topic}",
            "",
            "> 本页是资料路由，不是可直接对外发布的成稿。原文片段只保存一份，本页通过链接归入主题库。",
            "> 所有新增资料默认 `INTERNAL_SOURCE`；涉及领先性、客户、数据、荣誉和竞品的表述仍须通过证据与合规审核。",
            "",
            f"- 生成日期：{datetime.now().astimezone().isoformat(timespec='seconds')}",
            f"- 匹配章节：{len(records)}",
            f"- 主归类章节：{primary_count}",
            "",
        ]
        by_source: dict[str, list[dict]] = defaultdict(list)
        for record in records:
            by_source[record["source_id"]].append(record)
        for source_id, source_records in sorted(by_source.items()):
            lines.extend([f"## {source_id}", "", f"来源文件：{source_records[0]['source_file']}", ""])
            for record in source_records:
                section_path = Path(record["section_path"])
                link = relative_link(target, section_path)
                marker = "主归类" if record["primary_topic"] == topic else "交叉归类"
                lines.append(
                    f"- [{record['title']}]({link})"
                    f"（{record['source_range']}；{record['char_count']} 字；{marker}）"
                )
            lines.append("")
        target.write_text("\n".join(lines), encoding="utf-8")

    coverage_path = INGESTED / "topic_routing_manifest.json"
    routing_manifest = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_section_count": len(coverage),
        "primary_assignment_count": len(coverage),
        "unassigned_count": 0,
        "topic_counts": {topic: len(routes.get(topic, [])) for topic in TOPIC_TARGETS},
        "sections": coverage,
    }
    coverage_path.write_text(
        json.dumps(routing_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = KNOWLEDGE / "sources" / "六份大批量资料拆分与归库总表.md"
    lines = [
        "# 六份大批量资料拆分与归库总表",
        "",
        f"> 批次：`BATCH-20260730-BSC-6DOCX`；生成日期：{datetime.now().date().isoformat()}。",
        "",
        "## 覆盖结果",
        "",
        f"- 原始文件：{len(source_manifests)} 份；",
        f"- 来源章节：{len(coverage)} 个；",
        f"- 主归类：{len(coverage)} 个；",
        "- 未归类：0 个；",
        "- 同一章节可进入多个主题索引，但原文只保留一份，避免版本分叉。",
        "",
        "## 主题资料库",
        "",
        "| 主题库 | 匹配章节 | 索引 |",
        "|---|---:|---|",
    ]
    for topic, target in TOPIC_TARGETS.items():
        lines.append(
            f"| {topic} | {len(routes.get(topic, []))} | [{target.name}]({relative_link(summary, target)}) |"
        )
    lines.extend(
        [
            "",
            "## 使用规则",
            "",
            "1. 创作时先读取合规、保密和证据台账，再按主题索引读取来源片段；",
            "2. 来源片段不是已批准事实，出现数据、客户、荣誉、领先性或产品状态时必须查证据台账；",
            "3. 新日期文档不会静默覆盖旧口径，所有冲突进入《版本冲突与公开风险清单》；",
            "4. 国内竞品名称仅允许在内部资料中保留，对外必须按系统大类匿名；",
            "5. 内部讲话、集团战略、销售手册和研究报告默认不得整段对外引用。",
            "",
        ]
    )
    summary.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
