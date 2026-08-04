import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AI-Content-Factory migration", () => {
  it("discovers content-side records and excludes platform operations in dry-run", () => {
    const directory = mkdtempSync(join(tmpdir(), "agt004-migration-"));
    temporaryDirectories.push(directory);
    const source = join(directory, "legacy.sqlite");
    const report = join(directory, "report.json");
    const database = new DatabaseSync(source);
    database.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT, user_input TEXT,
        selected_platforms_json TEXT, status TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE task_contents (
        id TEXT PRIMARY KEY, task_id TEXT, platform TEXT, content_type TEXT,
        title TEXT, body_json TEXT, publish_status TEXT, version INTEGER,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE skills (
        id TEXT PRIMARY KEY, name TEXT, source_type TEXT, source_ref TEXT,
        summary TEXT, status TEXT, skill_kind TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE platform_settings (
        platform TEXT PRIMARY KEY, base_rules_json TEXT,
        enabled_skill_ids_json TEXT, image_skill_ids_json TEXT,
        image_model TEXT, updated_at TEXT
      );
      CREATE TABLE history_actions (
        id TEXT PRIMARY KEY, task_id TEXT, action_type TEXT,
        payload_json TEXT, created_at TEXT
      );
      INSERT INTO tasks VALUES (
        'task-1', 'Title', 'Brief', '["wechat","x"]', 'done',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO task_contents VALUES (
        'content-1', 'task-1', 'wechat', 'article', 'Title',
        '{"body":"Article","cover":"./generated/cover.png","access_token":"must-not-migrate"}',
        'published', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO task_contents VALUES (
        'content-2', 'task-1', 'x', 'post', 'Short',
        '{"body":"Short variant"}', 'draft', 1,
        '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'
      );
      INSERT INTO skills VALUES (
        'skill-1', 'Writer', 'upload', 'skills/writer.md',
        'Write governed content', 'active', 'content',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO platform_settings VALUES (
        'wechat', '{"tone":"professional"}', '[]', '[]', 'legacy-model',
        '2026-01-01T00:00:00.000Z'
      );
      INSERT INTO history_actions VALUES (
        'history-1', 'task-1', 'edit',
        '{"body":"Changed","publish_status":"published","api_key":"secret"}',
        '2026-01-03T00:00:00.000Z'
      );
    `);
    database.close();

    const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
    execFileSync(
      process.execPath,
      [
        tsxCli,
        "scripts/migrate-ai-content-factory.ts",
        "--source",
        source,
        "--dry-run=true",
        "--report",
        report,
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    );
    const result = JSON.parse(readFileSync(report, "utf8"));
    expect(result.imported).toMatchObject({
      missions: 1,
      contentAssets: 1,
      contentVersions: 2,
      skills: 1,
      skillVersions: 1,
      contentTemplates: 1,
      editHistory: 1,
      generatedAssetReferences: 1,
    });
    expect(result.excludedByBoundary).toContain("task_contents.publish_status");
    expect(JSON.stringify(result)).not.toContain("must-not-migrate");
  });
});
