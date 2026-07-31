from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from docx import Document


ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE = ROOT / "knowledge"
INGESTED = KNOWLEDGE / "sources" / "ingested"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def validate() -> dict:
    errors: list[str] = []
    batch = json.loads((INGESTED / "batch_manifest.json").read_text(encoding="utf-8"))
    routing = json.loads((INGESTED / "topic_routing_manifest.json").read_text(encoding="utf-8"))
    context = json.loads((ROOT / "active_context.json").read_text(encoding="utf-8"))

    if context.get("workspaceVersion") != "4.0":
        errors.append(f"Expected workspaceVersion 4.0, got {context.get('workspaceVersion')}")

    if batch["source_count"] != 6:
        errors.append(f"Expected 6 batch sources, got {batch['source_count']}")
    if batch["total_sections"] != 474:
        errors.append(f"Expected 474 sections, got {batch['total_sections']}")
    if routing["source_section_count"] != batch["total_sections"]:
        errors.append("Routing section count does not match batch")
    if routing["unassigned_count"] != 0:
        errors.append(f"Unassigned sections: {routing['unassigned_count']}")

    checked_sections = 0
    checked_blocks = 0
    for source in batch["sources"]:
        source_dir = INGESTED / source["source_id"]
        manifest_path = source_dir / "source_manifest.json"
        if not manifest_path.exists():
            errors.append(f"Missing manifest: {manifest_path}")
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        original = Path(manifest["original_path"])
        if not original.exists():
            errors.append(f"Missing original: {original}")
        elif sha256(original) != manifest["sha256"]:
            errors.append(f"Hash mismatch: {original}")
        full_text = source_dir / "full_text.md"
        if not full_text.exists():
            errors.append(f"Missing full text: {full_text}")
        else:
            locator_count = len(re.findall(r"<!-- (?:P|T)\d+", full_text.read_text(encoding="utf-8")))
            expected = manifest["counts"]["ordered_nonempty_blocks"]
            if locator_count != expected:
                errors.append(f"Locator count mismatch for {source['source_id']}: {locator_count} != {expected}")
            checked_blocks += locator_count
        for section in manifest["section_index"]:
            section_path = source_dir / section["file"]
            if not section_path.exists():
                errors.append(f"Missing section: {section_path}")
            checked_sections += 1

    for path_text in context["knowledgeFiles"]:
        path = ROOT / path_text
        if not path.exists():
            errors.append(f"Missing active knowledge file: {path}")
    for key in ("activeKnowledgeIndex", "activeComplianceRule", "activeConfidentialityRule",
                "activeConflictRegister", "activeEvidenceGate", "activeProductCanon",
                "activeScenarioCanon", "activeICBFactCard", "activePolicyGuide",
                "activeWebsiteSnapshot", "activeAgentRoster", "activeWebsiteVisualGuide"):
        path = ROOT / context[key]
        if not path.exists():
            errors.append(f"Missing active context target {key}: {path}")

    product_canon = (ROOT / context["activeProductCanon"]).read_text(encoding="utf-8")
    for phrase in ("专业智能体", "智能体团队", "九大 AI 原生商业模式", "JovaOS 平台"):
        if phrase not in product_canon:
            errors.append(f"Missing product matrix phrase: {phrase}")

    scenario_canon = (ROOT / context["activeScenarioCanon"]).read_text(encoding="utf-8")
    for phrase in (
        "渠道增长", "询报价", "库存周转", "供应商网络", "产品定价",
        "出海增长", "业财决策", "产业资源重组", "AI 自营采购模式",
        "AI 采购联盟 / 撮合采购模式", "AI 自营销售 / 数字渠道网络模式",
        "AI 销售撮合 / 平台分销模式", "AI 自营采销一体模式",
        "AI 撮合采销一体模式", "AI 双企业协同经营模式",
        "AI 多方供应链重组模式", "AI 产业集群生态模式",
    ):
        if phrase not in scenario_canon:
            errors.append(f"Missing scenario/business-model phrase: {phrase}")

    icb_card = (ROOT / context["activeICBFactCard"]).read_text(encoding="utf-8")
    for phrase in (
        "全球首个跨产业实时交易算法", "300 多个行业", "30 万家注册企业",
        "3000 多家龙头企业", "600 亿产业交易", "3000+ 功能元",
        "历时 6 年", "构建全球最大的产业级智能体网络",
    ):
        if phrase not in icb_card:
            errors.append(f"Missing ICB canonical phrase: {phrase}")

    policy_guide = (ROOT / context["activePolicyGuide"]).read_text(encoding="utf-8")
    for domain in ("www.gov.cn", "www.cac.gov.cn", "www.beijing.gov.cn"):
        if domain not in policy_guide:
            errors.append(f"Missing official policy source domain: {domain}")

    website_snapshot = (ROOT / context["activeWebsiteSnapshot"]).read_text(encoding="utf-8")
    for phrase in ("https://www.jovaai.com/", "八大核心场景", "艾氪智能有限公司",
                   "4009026188", "粤ICP备2024350742号-4"):
        if phrase not in website_snapshot:
            errors.append(f"Missing website snapshot phrase: {phrase}")

    agent_roster = (ROOT / context["activeAgentRoster"]).read_text(encoding="utf-8")
    for phrase in ("合嘉", "泽宇", "清妍", "雅琳", "文昊", "官网公开智能体名单"):
        if phrase not in agent_roster:
            errors.append(f"Missing current website agent: {phrase}")

    visual_guide = (ROOT / context["activeWebsiteVisualGuide"]).read_text(encoding="utf-8")
    for phrase in ("#2A4A5A", "#3B82F6", "PingFang SC", "Microsoft YaHei"):
        if phrase not in visual_guide:
            errors.append(f"Missing website visual observation: {phrase}")

    broken_links = []
    link_pattern = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    for markdown in KNOWLEDGE.rglob("*.md"):
        text = markdown.read_text(encoding="utf-8")
        for raw_target in link_pattern.findall(text):
            target = raw_target.strip().split("#", 1)[0]
            if not target or re.match(r"^[a-z]+://", target, re.I):
                continue
            candidate = (markdown.parent / target).resolve()
            if not candidate.exists():
                broken_links.append(f"{markdown}: {raw_target}")
    if broken_links:
        errors.extend(f"Broken link: {item}" for item in broken_links)

    export = ROOT / "exports" / "艾氪智能企业品牌产品内容知识库_V4.0_内部版.docx"
    if not export.exists():
        errors.append(f"Missing V4 export: {export}")
        export_paragraphs = 0
    else:
        export_document = Document(export)
        export_paragraphs = len(export_document.paragraphs)
        if export_paragraphs < 100:
            errors.append(f"V4 export unexpectedly short: {export_paragraphs} paragraphs")

    return {
        "status": "PASS" if not errors else "FAIL",
        "source_count": batch["source_count"],
        "checked_blocks": checked_blocks,
        "checked_sections": checked_sections,
        "routing_unassigned": routing["unassigned_count"],
        "topic_counts": routing["topic_counts"],
        "active_knowledge_files": len(context["knowledgeFiles"]),
        "broken_link_count": len(broken_links),
        "export_paragraphs": export_paragraphs,
        "errors": errors,
    }


if __name__ == "__main__":
    result = validate()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["status"] == "PASS" else 1)
