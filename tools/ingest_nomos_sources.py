#!/usr/bin/env python3
"""Ingest Nomos DOCX sources without activating any derived knowledge.

The tool treats every document as untrusted source content. It copies the
immutable binary, extracts reviewable OOXML text (including tracked changes,
comments, headers, footers, tables and hyperlinks), scans for high-risk package
parts and credential-like strings, and writes deterministic source manifests.
It never follows document links and never promotes extracted statements into
the active knowledge bundle.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W_NS, "r": R_NS, "pr": PKG_REL_NS}

SECRET_PATTERNS = {
    "authorization_header": re.compile(r"(?i)authorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}"),
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "generic_secret": re.compile(r"(?i)(?:api[_ -]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9_\-./+=]{16,}"),
    "github_token": re.compile(r"\bgh[opusr]_[A-Za-z0-9]{30,}\b"),
}

RISKY_PACKAGE_PARTS = (
    "vbaproject.bin",
    "embeddings/",
    "activex/",
    "customui/",
    "oleobject",
)


@dataclass(frozen=True)
class SourceSpec:
    source_id: str
    path: Path
    source_type: str
    source_date: str
    authority_level: int
    derived_from: tuple[str, ...] = ()
    supersedes: tuple[str, ...] = ()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_member(name: str) -> bool:
    normalized = name.replace("\\", "/")
    return not (
        normalized.startswith("/")
        or normalized.startswith("../")
        or "/../" in normalized
        or ":" in normalized.split("/")[0]
    )


def relationship_targets(archive: zipfile.ZipFile) -> dict[str, str]:
    rels: dict[str, str] = {}
    name = "word/_rels/document.xml.rels"
    if name not in archive.namelist():
        return rels
    root = ET.fromstring(archive.read(name))
    for rel in root.findall("pr:Relationship", NS):
        rel_id = rel.attrib.get("Id")
        target = rel.attrib.get("Target")
        mode = rel.attrib.get("TargetMode")
        if rel_id and target and mode == "External":
            rels[rel_id] = target
    return rels


def node_text(node: ET.Element) -> str:
    chunks: list[str] = []
    for child in node.iter():
        local = child.tag.rsplit("}", 1)[-1]
        if local in {"t", "delText", "instrText", "delInstrText"} and child.text:
            chunks.append(child.text)
        elif local == "tab":
            chunks.append("\t")
        elif local in {"br", "cr"}:
            chunks.append("\n")
    return "".join(chunks).strip()


def extract_part(xml_bytes: bytes, external_rels: dict[str, str]) -> tuple[list[dict[str, object]], dict[str, int]]:
    root = ET.fromstring(xml_bytes)
    records: list[dict[str, object]] = []
    counts = {"paragraphs": 0, "tables": 0, "insertions": 0, "deletions": 0, "hyperlinks": 0}

    for paragraph in root.findall(".//w:p", NS):
        text = node_text(paragraph)
        if not text:
            continue
        record: dict[str, object] = {"kind": "paragraph", "text": text, "sourceContentOnly": True}
        insertions = [node_text(item) for item in paragraph.findall(".//w:ins", NS) if node_text(item)]
        deletions = [node_text(item) for item in paragraph.findall(".//w:del", NS) if node_text(item)]
        links: list[dict[str, str]] = []
        for link in paragraph.findall(".//w:hyperlink", NS):
            rel_id = link.attrib.get(f"{{{R_NS}}}id")
            link_text = node_text(link)
            if rel_id and rel_id in external_rels:
                links.append({"text": link_text, "target": external_rels[rel_id], "followed": "false"})
        if insertions:
            record["trackedInsertions"] = insertions
        if deletions:
            record["trackedDeletions"] = deletions
        if links:
            record["hyperlinks"] = links
        records.append(record)
        counts["paragraphs"] += 1
        counts["insertions"] += len(insertions)
        counts["deletions"] += len(deletions)
        counts["hyperlinks"] += len(links)

    for table in root.findall(".//w:tbl", NS):
        rows: list[list[str]] = []
        for row in table.findall("./w:tr", NS):
            rows.append([node_text(cell) for cell in row.findall("./w:tc", NS)])
        if rows:
            records.append({"kind": "table", "rows": rows, "sourceContentOnly": True})
            counts["tables"] += 1
    return records, counts


def extract_docx(path: Path) -> tuple[dict[str, object], bytes, list[str], list[dict[str, object]]]:
    warnings: list[str] = []
    package_findings: list[dict[str, object]] = []
    extracted: dict[str, object] = {"document": [], "headers": [], "footers": [], "comments": []}
    totals = {"paragraphs": 0, "tables": 0, "insertions": 0, "deletions": 0, "hyperlinks": 0}

    if not zipfile.is_zipfile(path):
        raise ValueError("Not a valid DOCX/ZIP package")
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        unsafe = [name for name in names if not safe_member(name)]
        if unsafe:
            raise ValueError(f"Unsafe ZIP member paths: {unsafe[:3]}")
        for name in names:
            lower = name.lower()
            if any(marker in lower for marker in RISKY_PACKAGE_PARTS):
                package_findings.append({"type": "risky_package_part", "part": name})

        rels = relationship_targets(archive)
        for rel_id, target in rels.items():
            package_findings.append({"type": "external_relationship", "relationshipId": rel_id, "target": target, "followed": False})

        parts: list[tuple[str, str]] = []
        if "word/document.xml" in names:
            parts.append(("document", "word/document.xml"))
        else:
            raise ValueError("DOCX is missing word/document.xml")
        parts.extend(("headers", name) for name in names if re.fullmatch(r"word/header\d+\.xml", name))
        parts.extend(("footers", name) for name in names if re.fullmatch(r"word/footer\d+\.xml", name))

        for bucket, name in parts:
            try:
                records, counts = extract_part(archive.read(name), rels)
                if bucket == "document":
                    extracted[bucket] = records
                else:
                    extracted[bucket].append({"part": name, "records": records})  # type: ignore[union-attr]
                for key, value in counts.items():
                    totals[key] += value
            except ET.ParseError as exc:
                warnings.append(f"Could not parse {name}: {exc}")

        if "word/comments.xml" in names:
            try:
                comments_root = ET.fromstring(archive.read("word/comments.xml"))
                for comment in comments_root.findall(".//w:comment", NS):
                    extracted["comments"].append({  # type: ignore[union-attr]
                        "id": comment.attrib.get(f"{{{W_NS}}}id"),
                        "author": comment.attrib.get(f"{{{W_NS}}}author"),
                        "date": comment.attrib.get(f"{{{W_NS}}}date"),
                        "text": node_text(comment),
                        "sourceContentOnly": True,
                    })
            except ET.ParseError as exc:
                warnings.append(f"Could not parse comments.xml: {exc}")

    extracted["counts"] = totals
    extracted["instructionDisposition"] = "SOURCE_CONTENT_ONLY"
    extracted["externalLinksFollowed"] = False
    rendered = (json.dumps(extracted, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")
    return extracted, rendered, warnings, package_findings


def scan_secrets(text: str) -> list[dict[str, object]]:
    findings: list[dict[str, object]] = []
    for pattern_name, pattern in SECRET_PATTERNS.items():
        for match in pattern.finditer(text):
            findings.append({"type": pattern_name, "offset": match.start(), "redacted": True})
    return findings


def specs_from_args(paths: Iterable[str]) -> list[SourceSpec]:
    resolved = [Path(item).resolve() for item in paths]
    if len(resolved) != 9:
        raise ValueError(f"Expected exactly 9 Nomos source documents, got {len(resolved)}")
    authorities = [2, 5, 4, 6, 3, 4, 3, 5, 5]
    source_types = [
        "corrected_transcript",
        "raw_transcript",
        "ai_summary",
        "rd_document",
        "curated_master",
        "summary",
        "historical_master",
        "meeting_record",
        "corrected_transcript",
    ]
    dates = ["2026-08-20", "2026-08-20", "2026-08-20", "2026-08-20", "2026-08-20", "2026-08-20", "2026-08-20", "2026-08-19", "2026-08-19"]
    return [
        SourceSpec(f"SRC-NOMOS-202608-{index:02d}", path, source_types[index - 1], dates[index - 1], authorities[index - 1])
        for index, path in enumerate(resolved, start=1)
    ]


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def ingest(specs: list[SourceSpec], repository_root: Path) -> dict[str, object]:
    raw_root = repository_root / "knowledge" / "sources" / "raw" / "nomos" / "2026-08-19_20"
    extracted_root = repository_root / "knowledge" / "sources" / "ingested" / "nomos-canon-20260820-v1.0.0"
    manifest_records: list[dict[str, object]] = []
    all_findings: list[dict[str, object]] = []

    for spec in specs:
        if not spec.path.is_file():
            raise FileNotFoundError(spec.path)
        raw_name = f"{spec.source_id}__{spec.path.name}"
        raw_target = raw_root / raw_name
        raw_target.parent.mkdir(parents=True, exist_ok=True)
        if raw_target.exists() and sha256_file(raw_target) != sha256_file(spec.path):
            raise RuntimeError(f"Immutable raw source collision: {raw_target}")
        if not raw_target.exists():
            shutil.copyfile(spec.path, raw_target)

        extracted, rendered, warnings, package_findings = extract_docx(raw_target)
        secret_findings = scan_secrets(rendered.decode("utf-8"))
        source_dir = extracted_root / spec.source_id
        atomic_write(source_dir / "extracted.json", rendered)
        text_lines: list[str] = []
        for record in extracted["document"]:  # type: ignore[index]
            if record.get("kind") == "paragraph":
                text_lines.append(str(record.get("text", "")))
            elif record.get("kind") == "table":
                for row in record.get("rows", []):
                    text_lines.append(" | ".join(str(cell) for cell in row))
        extracted_text = "\n\n".join(text_lines).encode("utf-8")
        atomic_write(source_dir / "full_text.md", extracted_text)

        completeness = "COMPLETE" if not warnings else "PARTIAL"
        record = {
            "schemaVersion": "1.0.0",
            "sourceId": spec.source_id,
            "originalFileName": spec.path.name,
            "repositoryPath": raw_target.relative_to(repository_root).as_posix(),
            "binaryHash": sha256_file(raw_target),
            "extractedTextHash": sha256_bytes(extracted_text),
            "structuredExtractionHash": sha256_bytes(rendered),
            "sourceType": spec.source_type,
            "sourceDate": spec.source_date,
            "authorityLevel": spec.authority_level,
            "confidentiality": "INTERNAL",
            "repositoryVisibility": "PUBLIC",
            "publicationDisposition": "INTERNAL_SOURCE",
            "derivedFrom": list(spec.derived_from),
            "supersedes": list(spec.supersedes),
            "extractionCompleteness": completeness,
            "extractionWarnings": warnings,
            "extractionCounts": extracted["counts"],
            "securityScan": {
                "status": "BLOCKED" if secret_findings or any(item["type"] == "risky_package_part" for item in package_findings) else "PASSED",
                "credentialLikeFindings": secret_findings,
                "packageFindings": package_findings,
                "linksFollowed": False,
            },
            "knowledgeActivation": "NOT_ACTIVATED",
        }
        atomic_write(source_dir / "source_manifest.json", (json.dumps(record, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        manifest_records.append(record)
        all_findings.extend({"sourceId": spec.source_id, **finding} for finding in secret_findings + package_findings)

    bundle = {
        "schemaVersion": "1.0.0",
        "bundleId": "nomos-canon-20260820-v1.0.0",
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceCount": len(manifest_records),
        "sources": manifest_records,
        "activationStatus": "CANDIDATE_ONLY",
        "instructionsExecuted": False,
        "externalLinksFollowed": False,
    }
    atomic_write(extracted_root / "source_manifest.json", (json.dumps(bundle, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    report = {
        "bundleId": bundle["bundleId"],
        "allSourcesComplete": all(item["extractionCompleteness"] == "COMPLETE" for item in manifest_records),
        "allSecurityScansPassed": all(item["securityScan"]["status"] == "PASSED" for item in manifest_records),
        "knowledgeActivationAllowed": False,
        "findings": all_findings,
    }
    atomic_write(extracted_root / "INGESTION_REPORT.json", (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", nargs="+")
    parser.add_argument("--repository-root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    try:
        report = ingest(specs_from_args(args.sources), Path(args.repository_root).resolve())
    except Exception as exc:  # fail closed for ingestion
        print(f"Nomos ingestion failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
