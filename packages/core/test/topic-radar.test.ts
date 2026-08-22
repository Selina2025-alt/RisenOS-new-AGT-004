import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LocalTopicRadarPort } from "../src/index.js";

describe("local topic radar adapter", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function workspace(script: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "agt004-radar-"));
    roots.push(root);
    await mkdir(join(root, "tools"), { recursive: true });
    await writeFile(join(root, "tools", "build_daily_radar.py"), script, "utf8");
    return root;
  }

  it("accepts only a READY output whose hash and metadata match", async () => {
    const hash = "a".repeat(64);
    const root = await workspace(`
const fs=require('fs'),p=require('path');
const d=p.join(process.cwd(),'intelligence','topic-radar','2026-01-01','radar-ok');fs.mkdirSync(d,{recursive:true});
fs.writeFileSync(p.join(d,'topic-pool.json'),JSON.stringify({radarId:'radar-ok',inputHash:'${hash}',topics:[{}],sourceHealth:[]}));
fs.writeFileSync(p.join(d,'topic-report.md'),'ok');fs.writeFileSync(p.join(d,'READY'),'${hash}');
fs.writeFileSync(p.join(process.cwd(),'intelligence','topic-radar','latest.json'),JSON.stringify({radarId:'radar-ok',inputHash:'${hash}',topicPool:'topic-radar/2026-01-01/radar-ok/topic-pool.json',topicReport:'topic-radar/2026-01-01/radar-ok/topic-report.md'}));
`);
    const port = new LocalTopicRadarPort({ workspaceRoot: root, pythonExecutable: process.execPath });
    const result = await port.run({ organizationId: "org_test001", traceId: "trace_test001", requestedBy: "user_test001" });
    expect(result.candidateCount).toBe(1);
    expect(result.radarId).toBe("radar-ok");
  });

  it("rejects a path that escapes the intelligence directory", async () => {
    const hash = "b".repeat(64);
    const root = await workspace(`
const fs=require('fs'),p=require('path');const d=p.join(process.cwd(),'intelligence','topic-radar');fs.mkdirSync(d,{recursive:true});
fs.writeFileSync(p.join(d,'latest.json'),JSON.stringify({radarId:'bad',inputHash:'${hash}',topicPool:'../outside.json',topicReport:'topic-radar/report.md'}));
`);
    const port = new LocalTopicRadarPort({ workspaceRoot: root, pythonExecutable: process.execPath });
    await expect(port.run({ organizationId: "org_test001", traceId: "trace_test001", requestedBy: "user_test001" }))
      .rejects.toThrow("escapes");
  });

  it("does not inherit application secrets into the radar child process", async () => {
    const hash = "c".repeat(64);
    process.env.AGT004_TEST_SECRET = "must-not-leak";
    const root = await workspace(`
if(process.env.AGT004_TEST_SECRET) throw new Error('secret leaked');
const fs=require('fs'),p=require('path');const d=p.join(process.cwd(),'intelligence','topic-radar','2026-01-01','radar-safe');fs.mkdirSync(d,{recursive:true});
fs.writeFileSync(p.join(d,'topic-pool.json'),JSON.stringify({radarId:'radar-safe',inputHash:'${hash}',topics:[],sourceHealth:[]}));
fs.writeFileSync(p.join(d,'topic-report.md'),'safe');fs.writeFileSync(p.join(d,'READY'),'${hash}');
fs.writeFileSync(p.join(process.cwd(),'intelligence','topic-radar','latest.json'),JSON.stringify({radarId:'radar-safe',inputHash:'${hash}',topicPool:'topic-radar/2026-01-01/radar-safe/topic-pool.json',topicReport:'topic-radar/2026-01-01/radar-safe/topic-report.md'}));
`);
    try {
      const port = new LocalTopicRadarPort({ workspaceRoot: root, pythonExecutable: process.execPath });
      await expect(port.run({ organizationId: "org_test001", traceId: "trace_test001", requestedBy: "user_test001" })).resolves.toMatchObject({ radarId: "radar-safe" });
    } finally {
      delete process.env.AGT004_TEST_SECRET;
    }
  });
});
