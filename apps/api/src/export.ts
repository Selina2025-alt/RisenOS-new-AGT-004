import type { ContentPackage } from "@risen/content-contracts";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export interface ExportResult {
  body: string | Uint8Array;
  contentType: string;
  extension: string;
}

function markdown(value: ContentPackage): string {
  const evidence = value.claimEvidenceBindings
    .map(
      (binding) =>
        `- Claim \`${binding.claimId}\` → ${binding.evidenceIds.map((id) => `\`${id}\``).join(", ") || "无"}`,
    )
    .join("\n");
  return [
    `# ${value.recommendedTitle}`,
    "",
    value.contentVersion.body,
    "",
    "## 内容元数据",
    "",
    `- 版本：${value.versionNumber}`,
    `- 内容哈希：\`${value.contentHash}\``,
    `- 校验：${value.validation.status}`,
    `- 标签：${value.tags.join("、")}`,
    "",
    "## Claim—Evidence",
    "",
    evidence,
  ].join("\n");
}

async function html(value: ContentPackage): Promise<string> {
  const body = String(
    await unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeSanitize)
      .use(rehypeStringify)
      .process(value.contentVersion.body),
  );
  const title = value.recommendedTitle
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title}</title></head>
<body><article><h1>${title}</h1>${body}</article></body>
</html>`;
}

export async function exportContentPackage(
  value: ContentPackage,
  format: "json" | "markdown" | "html" | "docx",
): Promise<ExportResult> {
  if (format === "json") {
    return {
      body: JSON.stringify(value, null, 2),
      contentType: "application/json; charset=utf-8",
      extension: "json",
    };
  }
  if (format === "markdown") {
    return {
      body: markdown(value),
      contentType: "text/markdown; charset=utf-8",
      extension: "md",
    };
  }
  if (format === "html") {
    return {
      body: await html(value),
      contentType: "text/html; charset=utf-8",
      extension: "html",
    };
  }

  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ text: value.recommendedTitle, heading: HeadingLevel.TITLE }),
        ...value.contentVersion.body.split(/\r?\n/).map(
          (line) => new Paragraph({ children: [new TextRun(line)] }),
        ),
        new Paragraph({
          text: `版本 ${value.versionNumber} · ${value.contentHash}`,
          heading: HeadingLevel.HEADING_2,
        }),
      ],
    }],
  });
  return {
    body: await Packer.toBuffer(document),
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  };
}
