import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url);
const scanRoots = ["apps/api/src", "apps/worker/src", "packages/adapters/src"];
const forbiddenPatterns = [
  /wechat-openapi/i,
  /xiaohongshu-publish/i,
  /twitter-publish/i,
  /publishStatus/,
  /platformContentId/,
  /scheduledAt/,
  /accessToken/,
  /monitoring-sync/i,
];
const allowedFiles = new Set(["packages/adapters/src/handoff.ts"]);
const failures = [];

for (const scanRoot of scanRoots) {
  await visit(new URL(`${scanRoot}/`, root));
}

if (failures.length > 0) {
  console.error("Platform boundary violations found:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Platform boundary check passed: no publishing or monitoring integration found.");

async function visit(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  for (const entry of entries) {
    const entryUrl = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) {
      await visit(new URL(`${entry.name}/`, directoryUrl));
      continue;
    }
    if (![".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) {
      continue;
    }
    const file = relative(root.pathname, entryUrl.pathname).replaceAll("\\", "/");
    if (allowedFiles.has(file)) {
      continue;
    }
    const source = await readFile(entryUrl, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(source)) {
        failures.push(`${file}: ${pattern}`);
      }
    }
  }
}
