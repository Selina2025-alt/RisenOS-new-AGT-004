import { readFile } from "node:fs/promises";

import {
  assertDraftGate,
  createMissionPreflight,
  validateCaseEvidence,
  validateNomosContent,
} from "../packages/core/src/index.js";

interface Fixture {
  missionId: string;
  purpose: string;
  content: string;
  expectedNomosCodes?: string[];
  expectedGate?: string;
  expectedCaseCodes?: string[];
  requiresNomosPolicy?: boolean;
  humanApprovalRequired?: boolean;
  golden: boolean;
}

const fixtureUrl = new URL("../tests/fixtures/v55-replay/missions.json", import.meta.url);
const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8")) as Fixture[];
const results = fixtures.map((fixture) => {
  const actualNomosCodes = fixture.requiresNomosPolicy === false
    ? []
    : validateNomosContent(fixture.content).map((issue) => issue.code).sort();
  const expectedNomosCodes = [...(fixture.expectedNomosCodes ?? [])].sort();
  let actualGate: string | undefined;
  if (fixture.expectedGate) {
    const preflight = createMissionPreflight({
      missionId: "mission_replay001",
      organizationId: "org_jovaai",
      createdBy: "user_enterprise",
      traceId: "trace_replay001",
      value: {
        missionClass: "PUBLIC_TOPIC",
        enterpriseRelevance: "NONE",
        topicEntities: [],
        publicationScope: "EXTERNAL_DRAFT",
        riskLevel: "LOW",
        requiresPublicResearch: true,
        requiresEnterpriseKnowledge: false,
        requiresNomosPolicy: false,
        requiresCasePolicy: false,
      },
    });
    try {
      assertDraftGate({ preflight });
    } catch (error) {
      actualGate = (error as { code?: string }).code;
    }
  }
  let actualCaseCodes: string[] = [];
  if (fixture.expectedCaseCodes) {
    const now = new Date().toISOString();
    actualCaseCodes = validateCaseEvidence({
      id: "case_replay001",
      organizationId: "org_jovaai",
      createdBy: "user_enterprise",
      traceId: "trace_replay001",
      createdAt: now,
      updatedAt: now,
      status: "CANDIDATE",
      caseAlias: "某马来西亚五金企业",
      countryOrRegion: "马来西亚",
      industry: "五金",
      anonymizationLevel: "REGION_AND_CATEGORY",
      metrics: [{ name: "处理时长", value: "20", unit: "%", evidenceRef: "evidence_replay001" }],
      measurementPeriod: "2026-Q2",
      baseline: "上线前四周",
      measurementMethod: "同口径比较",
      sourceRef: "SRC-NOMOS-202608-04",
      publicUseStatus: "NOT_REVIEWED",
      reidentificationRisk: "HIGH",
    }).map((issue) => issue.code).sort();
  }
  const expectedCaseCodes = [...(fixture.expectedCaseCodes ?? [])].sort();
  const passed = JSON.stringify(actualNomosCodes) === JSON.stringify(expectedNomosCodes)
    && actualGate === fixture.expectedGate
    && JSON.stringify(actualCaseCodes) === JSON.stringify(expectedCaseCodes);
  return {
    missionId: fixture.missionId,
    purpose: fixture.purpose,
    actualNomosCodes,
    expectedNomosCodes,
    actualGate,
    expectedGate: fixture.expectedGate,
    actualCaseCodes,
    expectedCaseCodes,
    passed,
    golden: fixture.golden,
    humanApprovalRequired: fixture.humanApprovalRequired ?? false,
  };
});
console.log(JSON.stringify({
  replayVersion: "5.5.0",
  allPassed: results.every((item) => item.passed),
  goldenSamples: results.filter((item) => item.golden).length,
  results,
}, null, 2));
if (results.some((item) => !item.passed)) process.exitCode = 1;
