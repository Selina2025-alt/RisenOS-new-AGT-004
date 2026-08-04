import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalFileStore } from "../src/index.js";

describe("local persistence", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it("writes atomically and appends audit events", async () => {
    root = await mkdtemp(join(tmpdir(), "agt004-"));
    const store = new LocalFileStore(root);
    const output = await store.writeJson("missions/M-1.json", { id: "M-1", status: "DRAFT" });
    expect(await store.readJson("missions/M-1.json")).toEqual({ id: "M-1", status: "DRAFT" });
    expect(output.contentHash).toHaveLength(64);
    await store.appendAudit({ traceId: "T-1", event: "created" });
    expect((await readFile(join(root, "audit/events.jsonl"), "utf8")).trim()).toContain("created");
  });
});

