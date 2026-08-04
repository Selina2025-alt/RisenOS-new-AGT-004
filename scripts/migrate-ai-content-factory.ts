import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

interface LegacyTask {
  id: string;
  title: string;
  user_input: string;
  selected_platforms_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface LegacyContent {
  id: string;
  task_id: string;
  platform: string;
  content_type: string;
  title: string;
  body_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface LegacySkill {
  id: string;
  name: string;
  source_type: string;
  source_ref: string;
  summary: string;
  status: string;
  skill_kind: string;
  created_at: string;
  updated_at: string;
}

interface LegacyPlatformSetting {
  platform: string;
  base_rules_json: string;
  updated_at: string;
}

interface LegacyHistoryAction {
  id: string;
  task_id: string;
  action_type: string;
  payload_json: string;
  created_at: string;
}

const args = parseArgs(process.argv.slice(2));
const sqlitePath = required(args, "source");
const connectionString = args.database ?? process.env.DATABASE_URL;
const organizationId = args.organization ?? "org_legacy_import";
const userId = args.user ?? "user_legacy_import";
const dryRun = args["dry-run"] === "true";

if (!connectionString && !dryRun) {
  throw new Error("DATABASE_URL or --database is required unless --dry-run=true");
}

const db = new DatabaseSync(resolve(sqlitePath), { readOnly: true });
const tasks = selectIfExists<LegacyTask>(db, "tasks");
const contents = selectIfExists<LegacyContent>(db, "task_contents");
const skills = selectIfExists<LegacySkill>(db, "skills");
const platformSettings = selectIfExists<LegacyPlatformSetting>(
  db,
  "platform_settings",
);
const historyActions = selectIfExists<LegacyHistoryAction>(db, "history_actions");
const orderedContents = [...contents].sort(
  (left, right) =>
    left.task_id.localeCompare(right.task_id) ||
    Date.parse(left.created_at) - Date.parse(right.created_at) ||
    left.version - right.version ||
    left.id.localeCompare(right.id),
);
const contentsByTask = new Map<string, LegacyContent[]>();
for (const content of orderedContents) {
  const group = contentsByTask.get(content.task_id) ?? [];
  group.push(content);
  contentsByTask.set(content.task_id, group);
}
const taskById = new Map(tasks.map((task) => [task.id, task]));
const report = {
  source: resolve(sqlitePath),
  dryRun,
  organizationId,
  imported: {
    missions: tasks.length,
    contentAssets: contentsByTask.size,
    contentVersions: contents.length,
    skills: skills.length,
    skillVersions: skills.length,
    contentTemplates: platformSettings.length,
    editHistory: historyActions.length,
    generatedAssetReferences: contents.reduce(
      (count, content) => count + extractImageRefs(parseJson(content.body_json)).length,
      0,
    ),
  },
  excludedByBoundary: [
    "platform_settings",
    "task_contents.publish_status",
    "publishing credentials and histories",
    "monitoring snapshots",
    "performance metrics",
    "skill_learning_results",
  ],
  warnings: [] as string[],
};

for (const content of contents) {
  if (!taskById.has(content.task_id)) {
    report.warnings.push(
      `Content ${content.id} references missing task ${content.task_id}`,
    );
  }
}

if (!dryRun && connectionString) {
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      for (const task of tasks) {
        const value = missionFromLegacy(task, organizationId, userId);
        await tx`
          INSERT INTO content_missions (
            id, organization_id, trace_id, status, payload, created_at, updated_at
          ) VALUES (
            ${value.id}, ${organizationId}, ${value.traceId}, ${value.status},
            ${tx.json(value)}, ${value.createdAt}, ${value.updatedAt}
          ) ON CONFLICT (id) DO NOTHING
        `;
      }

      for (const content of orderedContents) {
        const task = taskById.get(content.task_id);
        const siblings = contentsByTask.get(content.task_id) ?? [content];
        const ordinal = siblings.findIndex((item) => item.id === content.id) + 1;
        const previous = ordinal > 1 ? siblings[ordinal - 2] : undefined;
        const migrated = contentFromLegacy(
          content,
          task,
          organizationId,
          userId,
          ordinal,
          siblings,
          previous,
        );
        await tx`
          INSERT INTO content_versions (
            id, organization_id, asset_id, version_number, parent_version_id,
            content_hash, payload, created_at
          ) VALUES (
            ${migrated.version.id}, ${organizationId}, ${migrated.asset.id},
            ${migrated.version.versionNumber},
            ${migrated.version.parentVersionId ?? null},
            ${migrated.version.contentHash},
            ${tx.json(JSON.parse(JSON.stringify(migrated.version)))},
            ${migrated.version.createdAt}
          ) ON CONFLICT (id) DO NOTHING
        `;
        await tx`
          INSERT INTO content_assets (
            id, organization_id, mission_id, trace_id, status,
            payload, created_at, updated_at
          ) VALUES (
            ${migrated.asset.id}, ${organizationId}, ${migrated.asset.missionId},
            ${migrated.asset.traceId}, ${migrated.asset.status},
            ${tx.json(migrated.asset)}, ${migrated.asset.createdAt},
            ${migrated.asset.updatedAt}
          ) ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            payload = EXCLUDED.payload,
            updated_at = EXCLUDED.updated_at
        `;
        for (const [index, uri] of extractImageRefs(
          parseJson(content.body_json),
        ).entries()) {
          const generatedAsset = generatedAssetFromLegacy(
            content,
            migrated.asset.id,
            uri,
            index,
            organizationId,
            userId,
          );
          await tx`
            INSERT INTO generated_assets (
              id, organization_id, content_asset_id, status, payload,
              created_at, updated_at
            ) VALUES (
              ${generatedAsset.id}, ${organizationId},
              ${generatedAsset.contentAssetId}, ${generatedAsset.status},
              ${tx.json(generatedAsset)}, ${generatedAsset.createdAt},
              ${generatedAsset.updatedAt}
            ) ON CONFLICT (id) DO NOTHING
          `;
        }
      }

      for (const skill of skills) {
        const { skill: value, version } = skillFromLegacy(
          skill,
          organizationId,
          userId,
        );
        await tx`
          INSERT INTO skill_packages (
            id, organization_id, status, payload, created_at, updated_at
          ) VALUES (
            ${value.id}, ${organizationId}, ${value.status}, ${tx.json(value)},
            ${value.createdAt}, ${value.updatedAt}
          ) ON CONFLICT (id) DO NOTHING
        `;
        await tx`
          INSERT INTO skill_versions (
            id, organization_id, skill_id, status, payload, created_at, updated_at
          ) VALUES (
            ${version.id}, ${organizationId}, ${version.skillId},
            ${version.status}, ${tx.json(version)}, ${version.createdAt},
            ${version.updatedAt}
          ) ON CONFLICT (id) DO NOTHING
        `;
      }

      for (const setting of platformSettings) {
        const template = templateFromLegacy(setting, organizationId, userId);
        await tx`
          INSERT INTO content_templates (
            id, organization_id, status, revision, payload, created_at, updated_at
          ) VALUES (
            ${template.id}, ${organizationId}, ${template.status},
            ${template.revision}, ${tx.json(template)}, ${template.createdAt},
            ${template.updatedAt}
          ) ON CONFLICT (id) DO NOTHING
        `;
      }

      for (const history of historyActions) {
        const task = taskById.get(history.task_id);
        await tx`
          WITH claimed AS (
            INSERT INTO legacy_import_records (
              organization_id, source_type, source_id
            ) VALUES (
              ${organizationId}, 'history_action', ${history.id}
            )
            ON CONFLICT DO NOTHING
            RETURNING source_id
          )
          INSERT INTO audit_events (
            organization_id, trace_id, entity_type, entity_id, action,
            actor_id, snapshot, occurred_at
          )
          SELECT
            ${organizationId}, ${stableId("trace", history.task_id)},
            'LegacyContentHistory', ${stableId("history", history.id)},
            ${`LEGACY_${history.action_type}`}, ${userId},
            ${tx.json(JSON.parse(JSON.stringify({
              legacyImported: true,
              legacySourceId: history.id,
              taskId: history.task_id,
              taskTitle: task?.title ?? null,
              payload: stripForbiddenLegacyData(parseJson(history.payload_json)),
            })))},
            ${normalizeDate(history.created_at)}
          FROM claimed
        `;
      }
    });
  } finally {
    await sql.end();
  }
}

db.close();
const reportPath = resolve(
  args.report ?? `migration-report-${new Date().toISOString().replaceAll(":", "-")}.json`,
);
await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ...report, reportPath }, null, 2));

function missionFromLegacy(
  task: LegacyTask,
  org: string,
  user: string,
) {
  const id = stableId("mission", task.id);
  const traceId = stableId("trace", task.id);
  return {
    id,
    organizationId: org,
    createdBy: user,
    traceId,
    createdAt: normalizeDate(task.created_at),
    updatedAt: normalizeDate(task.updated_at),
    status: "DRAFT",
    title: task.title,
    objective: task.user_input,
    strategy: task.user_input,
    audience: ["旧系统未记录结构化受众"],
    message: task.title,
    contentPlan: `旧内容格式：${parseStringArray(task.selected_platforms_json).join(", ")}`,
    claims: [],
    evidence: [],
    brandRules: [],
    policies: [],
    requestedOutputs: ["content", "content_version", "content_variant"],
    channels: parseStringArray(task.selected_platforms_json)
      .map(mapChannel)
      .filter((item, index, values) => values.indexOf(item) === index),
    locales: ["zh-CN"],
    highRisk: false,
    attachmentSnapshots: [],
    legacyImported: true,
    legacySourceId: task.id,
    legacyStatus: task.status,
  };
}

function contentFromLegacy(
  content: LegacyContent,
  task: LegacyTask | undefined,
  org: string,
  user: string,
  versionNumber: number,
  siblings: LegacyContent[],
  previous: LegacyContent | undefined,
) {
  const bodyValue = parseJson(content.body_json);
  const body = extractBody(bodyValue);
  const channel = mapChannel(content.platform);
  const assetId = stableId("content_asset", content.task_id);
  const versionId = stableId("version", content.id);
  const traceId = stableId("trace", content.task_id);
  const createdAt = normalizeDate(content.created_at);
  const updatedAt = normalizeDate(content.updated_at);
  const title = content.title || task?.title || "旧内容资产";
  const primary = {
    channel,
    locale: "zh-CN",
    title,
    body,
    summary: title,
    tags: [],
    claimIdsUsed: [],
    formatMetadata: {
      legacyContentType: content.content_type,
      legacyPlatformFormat: content.platform,
    },
  };
  const version = {
    id: versionId,
    organizationId: org,
    createdBy: user,
    traceId,
    createdAt,
    updatedAt,
    status: "DRAFT",
    assetId,
    versionNumber,
    ...(previous
      ? { parentVersionId: stableId("version", previous.id) }
      : {}),
    title,
    body,
    contentHash: sha256(body),
    changeReason: "AI-Content-Factory legacy import; original lineage unavailable",
    changedBy: user,
    generationContextSnapshot: {
      legacyImported: true,
      legacySourceId: content.id,
      legacyTaskInput: task?.user_input ?? null,
      legacyContentMetadata: stripForbiddenLegacyData(bodyValue),
    },
    claimBindingSnapshot: [],
  };
  const asset = {
    id: assetId,
    organizationId: org,
    createdBy: user,
    traceId,
    createdAt,
    updatedAt,
    status: "DRAFT",
    missionId: stableId("mission", content.task_id),
    title,
    currentVersionId: versionId,
    versionIds: siblings.map((item) => stableId("version", item.id)),
    legacyImported: true,
    bundle: {
      brief: {
        objective: task?.user_input ?? title,
        audience: ["旧系统未记录结构化受众"],
        coreMessage: title,
        tone: ["旧系统未记录"],
        deliverables: ["content", "content_version"],
        channels: [channel],
        locales: ["zh-CN"],
        mustIncludeClaimIds: [],
        constraints: ["旧数据没有 Claim—Evidence 绑定，不得直接标记为已审核"],
      },
      research: {
        summary: "旧系统未保存结构化 ContentResearch。",
        evidenceDigest: [],
        researchGaps: [],
      },
      outline: {
        title,
        sections: [
          {
            heading: title,
            purpose: "保留旧内容正文",
            claimIds: [],
            evidenceIds: [],
          },
        ],
      },
      primary,
      variants: siblings
        .filter((item) => item.id !== content.id)
        .map((item) => {
          const siblingBody = extractBody(parseJson(item.body_json));
          return {
            channel: mapChannel(item.platform),
            locale: "zh-CN",
            title: item.title || task?.title || title,
            body: siblingBody,
            summary: item.title || task?.title || title,
            tags: [],
            claimIdsUsed: [],
            formatMetadata: {
              legacyContentType: item.content_type,
              legacyPlatformFormat: item.platform,
              legacyVersion: item.version,
            },
          };
        }),
      localizations: [],
      assetBriefs: [],
      mediaPitchDraft: "",
      answerBlocks: [],
      publicStatementDraft: "",
      reusePlan: [],
    },
  };
  return { asset, version };
}

function skillFromLegacy(skill: LegacySkill, org: string, user: string) {
  const skillId = stableId("skill", skill.id);
  const versionId = stableId("skill_version", skill.id);
  const skillValue = {
    id: skillId,
    organizationId: org,
    createdBy: user,
    traceId: stableId("trace", skill.id),
    createdAt: normalizeDate(skill.created_at),
    updatedAt: normalizeDate(skill.updated_at),
    status: "IMPORTED",
    name: skill.name,
    description: skill.summary,
    activeVersionId: undefined,
    versionIds: [versionId],
    legacyImported: true,
    legacySourceId: skill.id,
    legacyStatus: skill.status,
    activationBlockedReason:
      "旧 Skill 未经过 AGT-RSN-004 安全检查和内容回归测试",
  };
  const manifest = {
    version: "0.0.0",
    supportedOutputs: ["content", "content_variant"],
    systemPrompt: [
      skill.summary,
      `Legacy source type: ${skill.source_type}`,
      `Legacy source reference: ${skill.source_ref}`,
      "This imported Skill is disabled until security and regression checks pass.",
    ].join("\n"),
    requiredContext: [
      "strategy",
      "audience",
      "message",
      "claims",
      "evidence",
      "brandRules",
      "policies",
    ],
  };
  const version = {
    id: versionId,
    organizationId: org,
    createdBy: user,
    traceId: skillValue.traceId,
    createdAt: normalizeDate(skill.created_at),
    updatedAt: normalizeDate(skill.updated_at),
    status: "IMPORTED",
    skillId,
    semanticVersion: "0.0.0",
    manifest,
    manifestDigest: createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex"),
    securityPassed: false,
    regressionPassed: false,
    legacyImported: true,
    legacySourceId: skill.id,
    legacySkillKind: skill.skill_kind,
  };
  return { skill: skillValue, version };
}

function templateFromLegacy(
  setting: LegacyPlatformSetting,
  org: string,
  user: string,
) {
  const timestamp = normalizeDate(setting.updated_at);
  const channel = mapChannel(setting.platform);
  const parsedRules = stripForbiddenLegacyData(parseJson(setting.base_rules_json));
  return {
    id: stableId("template", setting.platform),
    organizationId: org,
    createdBy: user,
    traceId: stableId("trace", `template:${setting.platform}`),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "DRAFT",
    name: `${setting.platform} legacy content rules`,
    description:
      "Imported content-format rules. Manual review and activation are required.",
    instructions:
      typeof parsedRules === "string"
        ? parsedRules
        : JSON.stringify(parsedRules, null, 2),
    variables: [],
    supportedOutputs: ["content", "content_variant"],
    supportedChannels: [channel],
    supportedLocales: ["zh-CN"],
    revision: 1,
    legacyImported: true,
  };
}

function generatedAssetFromLegacy(
  content: LegacyContent,
  contentAssetId: string,
  uri: string,
  index: number,
  org: string,
  user: string,
) {
  return {
    id: stableId("generated_asset", `${content.id}:${index}:${uri}`),
    organizationId: org,
    createdBy: user,
    traceId: stableId("trace", content.task_id),
    createdAt: normalizeDate(content.created_at),
    updatedAt: normalizeDate(content.updated_at),
    status: "GENERATED",
    contentAssetId,
    assetBrief: {
      assetType: index === 0 ? "cover" : "illustration",
      purpose: "Legacy generated image reference",
      prompt: "Legacy prompt was not retained in a trusted structured form.",
      aspectRatio: "unknown",
      visualDirection: "legacyImported",
      rightsRequired: true,
    },
    uri,
    rights: {
      status: "UNKNOWN",
      restrictions: ["Manual source, license and attribution review required"],
    },
    legacyImported: true,
    legacySourceId: content.id,
  };
}

function selectIfExists<T>(db: DatabaseSync, table: string): T[] {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return exists ? (db.prepare(`SELECT * FROM ${table}`).all() as unknown as T[]) : [];
}

function parseArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    if (!rawKey) continue;
    result[rawKey] = inlineValue ?? values[index + 1] ?? "true";
    if (!inlineValue && values[index + 1] && !values[index + 1]!.startsWith("--")) {
      index += 1;
    }
  }
  return result;
}

function required(argsValue: Record<string, string>, key: string): string {
  const value = argsValue[key];
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function stableId(prefix: string, source: string): string {
  const hash = createHash("sha256")
    .update(`${organizationId}:${source}`)
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_legacy_${hash}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractBody(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  for (const key of ["body", "content", "article", "text", "script"]) {
    if (typeof record[key] === "string") return record[key];
  }
  return JSON.stringify(value, null, 2);
}

function extractImageRefs(value: unknown): string[] {
  const references = new Set<string>();
  const visit = (item: unknown, key = "") => {
    if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, key));
      return;
    }
    if (item && typeof item === "object") {
      Object.entries(item as Record<string, unknown>).forEach(([childKey, entry]) =>
        visit(entry, childKey),
      );
      return;
    }
    if (
      typeof item === "string" &&
      /(image|cover|illustration|asset|图片|封面)/i.test(key) &&
      (/^(?:https?:\/\/|s3:\/\/|\/api\/assets\/|\.?\/)/i.test(item) ||
        /\.(?:png|jpe?g|webp|gif|svg)$/i.test(item))
    ) {
      references.add(item);
    }
  };
  visit(value);
  return [...references];
}

function stripForbiddenLegacyData(value: unknown): unknown {
  const forbidden = /(access.?token|refresh.?token|api.?key|secret|password|cookie|credential|publish.?status|platform.?content.?id|scheduled.?at|exposure|impression|conversion|performance.?metric|learning.?proposal)/i;
  if (Array.isArray(value)) return value.map(stripForbiddenLegacyData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !forbidden.test(key))
      .map(([key, item]) => [key, stripForbiddenLegacyData(item)]),
  );
}

function mapChannel(value: string):
  | "generic"
  | "web"
  | "wechat"
  | "xiaohongshu"
  | "x"
  | "video" {
  const normalized = value.toLowerCase();
  if (normalized.includes("wechat")) return "wechat";
  if (normalized.includes("xiaohongshu") || normalized.includes("xhs")) {
    return "xiaohongshu";
  }
  if (normalized.includes("twitter") || normalized === "x") return "x";
  if (normalized.includes("video")) return "video";
  if (normalized.includes("web")) return "web";
  return "generic";
}
