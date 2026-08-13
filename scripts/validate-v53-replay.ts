import { createHash } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { validateXTweet } from "../packages/core/src/balala-variant.js";
import { reviewAiStyle, reviewLogic } from "../packages/core/src/review-gates.js";

interface ReplayManifest {
  traceId: string;
  missionId: string;
  sourceReviewStatus: string;
  channels: string[];
  expectedXhsCards: number;
  claimIds: string[];
  reviewStatus: string;
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const root = process.cwd();
const replayRoot = resolve(root, "variants", "replay-20260812");
const missions = ["MISSION-20260804-43A99C34F7", "MISSION-20260804-A419CA7CF9"];
const requiredChannels = ["wechat", "short_video", "xiaohongshu", "x", "linkedin"];
const forbiddenKeys = ["platformAccount", "publishTask", "publishStatus", "scheduledAt", "platformContentId", "authorization", "cookie", "token"];

function section(markdown: string, start: string, end?: string): string {
  const from = markdown.indexOf(start);
  if (from < 0) return "";
  const to = end ? markdown.indexOf(end, from + start.length) : -1;
  return markdown.slice(from, to < 0 ? undefined : to);
}

function add(checks: CheckResult[], name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

async function validateMission(missionId: string) {
  const dir = resolve(replayRoot, missionId);
  const manifest = JSON.parse(await readFile(resolve(dir, "replay-manifest.json"), "utf8")) as ReplayManifest;
  const book = await readFile(resolve(dir, "HUMAN_REVIEW_BOOK.md"), "utf8");
  const checks: CheckResult[] = [];

  add(checks, "approved source gate", manifest.sourceReviewStatus === "APPROVED_FOR_VARIANTS", manifest.sourceReviewStatus);
  add(checks, "five channel contract", requiredChannels.every((item) => manifest.channels.includes(item)) && manifest.channels.length === 5, manifest.channels.join(", "));
  add(checks, "human review gate", manifest.reviewStatus === "HUMAN_REVIEW", manifest.reviewStatus);

  const wechat = section(book, "## 一、微信公众号", "## 二、短视频文案");
  const subheads = [...wechat.matchAll(/^### ([^\r\n]+：[^\r\n]+)$/gm)].flatMap((match) => match[1] ? [match[1]] : []);
  add(checks, "wechat subheads", subheads.length >= 3 && subheads.every((title) => [...title].length <= 13), `${subheads.length} subheads; ${subheads.map((item) => `${item}(${[...item].length})`).join(" | ")}`);
  const aiStyle = reviewAiStyle(wechat, "wechat_article");
  add(checks, "lilith AI-style gate", aiStyle.status !== "REVISION_REQUIRED" && aiStyle.status !== "BLOCKED", `${aiStyle.status}; ${aiStyle.signalFamilies.join(", ") || "no clustered signals"}`);
  const logic = reviewLogic(wechat, ["艾氪智能", "JovaAI", "产业级Agentic OS"]);
  add(checks, "lilith logic gate", logic.status !== "BLOCKED", `${logic.status}; ${logic.issues.map((item) => item.code).join(", ") || "no issue"}`);

  const video = section(book, "## 二、短视频文案", "## 三、小红书图文");
  add(checks, "video production fields", ["三个 Hook", "口播", "镜头", "字幕", "封面文案"].every((item) => video.includes(item)), "hook / voice / shots / subtitles / cover");

  const xhs = section(book, "## 三、小红书图文", "## 四、X / Twitter Thread");
  const cards = [...xhs.matchAll(/^\*\*第\d+张/gm)].length;
  add(checks, "xiaohongshu deep-card count", cards === manifest.expectedXhsCards && cards >= 5 && cards <= 9, `${cards} cards`);

  const x = section(book, "## 四、X / Twitter Thread", "## 五、LinkedIn 公司主页");
  const tweets = [...x.matchAll(/^\d+\/ (.+)$/gm)].flatMap((match) => match[1] ? [match[1]] : []);
  const tweetResults = tweets.map((tweet, index) => ({ index: index + 1, ...validateXTweet(tweet) }));
  add(checks, "x weighted length", tweets.length >= 5 && tweetResults.every((item) => item.ok), tweetResults.map((item) => `${item.index}:${item.count}`).join(", "));
  add(checks, "x first-post judgment", /AI|model evaluation|agent/i.test(tweets[0] ?? ""), tweets[0]?.slice(0, 80) ?? "missing");

  const linkedin = section(book, "## 五、LinkedIn 公司主页", "## 六、莉莉丝轻量复核");
  const english = section(linkedin, "### English primary post", "### 中文备稿");
  const chinese = section(linkedin, "### 中文备稿");
  const equivalentClaims = manifest.claimIds.every((claim) => english.includes(claim) && chinese.includes(claim));
  add(checks, "linkedin fact equivalence", equivalentClaims, `equivalent claim ids: ${manifest.claimIds.join(", ")}`);
  add(checks, "linkedin alt text", chinese.includes("Alt Text："), "Alt Text present");

  const inherited = manifest.claimIds.every((claim) => book.includes(claim));
  add(checks, "claim inheritance", inherited, manifest.claimIds.join(", "));
  const channelSections = { wechat, video, xiaohongshu: xhs, x, linkedin };
  const perChannelClaims = Object.entries(channelSections).map(([channel, content]) => ({
    channel,
    missing: manifest.claimIds.filter((claim) => !content.includes(claim)),
  }));
  add(checks, "per-channel claim inheritance", perChannelClaims.every((item) => item.missing.length === 0), perChannelClaims.map((item) => `${item.channel}:${item.missing.length ? item.missing.join("+") : "complete"}`).join(" | "));
  const serialized = JSON.stringify(manifest);
  add(checks, "no publishing fields", forbiddenKeys.every((key) => !serialized.toLowerCase().includes(key.toLowerCase())), "manifest contains no publishing/account/credential fields");
  add(checks, "lilith lightweight review", book.includes("## 六、莉莉丝轻量复核") && book.includes("决策：`HUMAN_REVIEW`"), "review section and human gate present");

  return {
    missionId,
    traceId: manifest.traceId,
    contentHash: createHash("sha256").update(book).digest("hex").toUpperCase(),
    passed: checks.every((item) => item.ok),
    checks,
  };
}

const missionResults = await Promise.all(missions.map(validateMission));
let kevinVariantsAbsent = false;
try {
  await access(resolve(replayRoot, "MISSION-20260804-7F93944F59"));
} catch {
  kevinVariantsAbsent = true;
}
const kevinBlockedRecordPresent = await access(resolve(replayRoot, "KEVIN-KELLY-BLOCKED.md")).then(() => true, () => false);
const result = {
  schemaVersion: "5.3-replay-validation-1",
  generatedAt: new Date().toISOString(),
  passed: missionResults.every((item) => item.passed) && kevinVariantsAbsent && kevinBlockedRecordPresent,
  missions: missionResults,
  blockedBranch: {
    missionId: "MISSION-20260804-7F93944F59",
    status: "EVIDENCE_INSUFFICIENT",
    variantsAbsent: kevinVariantsAbsent,
    blockedRecordPresent: kevinBlockedRecordPresent,
  },
};
await writeFile(resolve(replayRoot, "VALIDATION_RESULT.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
