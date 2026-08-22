import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

import {
  KnowledgeClaimCardSchema,
  KnowledgeConflictSchema,
  MissionPreflightInputSchema,
  PerspectiveContractInputSchema,
} from "../packages/contracts/src/index.js";
import {
  assertDraftGate,
  createKnowledgeSnapshot,
  createMissionPreflight,
  createPerspectiveContract,
} from "../packages/core/src/index.js";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (key && value) args.set(key, value);
}
const missionFile = args.get("--mission");
const preflightFile = args.get("--preflight");
const perspectiveFile = args.get("--perspective");
const knowledgeFile = args.get("--knowledge");
const outputFile = args.get("--output");
if (!missionFile || !preflightFile || !perspectiveFile || !outputFile) {
  throw new Error("Usage: --mission mission.json --preflight preflight.json --perspective perspective.json [--knowledge knowledge.json] --output gate.json");
}
const mission = JSON.parse(await readFile(resolve(missionFile), "utf8")) as Record<string, unknown>;
const required = ["id", "organizationId", "createdBy", "traceId"] as const;
for (const field of required) if (typeof mission[field] !== "string") throw new Error(`Mission ${field} is required`);
const preflight = createMissionPreflight({
  missionId: mission.id as string,
  organizationId: mission.organizationId as string,
  createdBy: mission.createdBy as string,
  traceId: mission.traceId as string,
  value: MissionPreflightInputSchema.parse(JSON.parse(await readFile(resolve(preflightFile), "utf8"))),
});
const perspective = createPerspectiveContract({
  missionId: mission.id as string,
  organizationId: mission.organizationId as string,
  createdBy: mission.createdBy as string,
  traceId: mission.traceId as string,
  value: PerspectiveContractInputSchema.parse(JSON.parse(await readFile(resolve(perspectiveFile), "utf8"))),
});

let knowledgeSnapshot;
if (knowledgeFile) {
  const knowledge = JSON.parse(await readFile(resolve(knowledgeFile), "utf8")) as {
    canonVersion?: string;
    claimCardIds?: string[];
    audienceLayer?: "BUSINESS" | "TECHNICAL" | "PROFESSIONAL_CONFERENCE";
  };
  const canonVersion = knowledge.canonVersion ?? "nomos-canon-20260820-v1.0.0";
  const claimCardIds = knowledge.claimCardIds ?? [];
  const audienceLayer = knowledge.audienceLayer;
  if (!claimCardIds.length || !audienceLayer) {
    throw new Error("Knowledge input requires claimCardIds and audienceLayer");
  }

  const repositoryRoot = process.cwd();
  const canonRoot = join(repositoryRoot, "knowledge", "canon", canonVersion);
  const sourceRoot = join(repositoryRoot, "knowledge", "sources", "ingested", canonVersion);
  const [manifestBytes, claimBytes, conflictBytes, sourceBytes] = await Promise.all([
    readFile(join(canonRoot, "ACTIVE_MANIFEST.json")),
    readFile(join(canonRoot, "claim-cards.json")),
    readFile(join(canonRoot, "conflicts.json")),
    readFile(join(sourceRoot, "source_manifest.json")),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    status?: string;
    approvedBy?: string;
    claimCardsHash?: string;
    sourceManifestHash?: string;
    activeClaimIds?: string[];
  };
  const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  if (manifest.status !== "ACTIVE" || !manifest.approvedBy) throw new Error("Nomos canon is not explicitly active");
  if (manifest.claimCardsHash !== digest(claimBytes)) throw new Error("ACTIVE_MANIFEST claimCardsHash mismatch");
  if (manifest.sourceManifestHash !== digest(sourceBytes)) throw new Error("ACTIVE_MANIFEST sourceManifestHash mismatch");

  const allCards = (JSON.parse(claimBytes.toString("utf8")) as unknown[]).map((item) => KnowledgeClaimCardSchema.parse(item));
  const activeIds = new Set(manifest.activeClaimIds ?? []);
  const selectedCards = claimCardIds.map((claimId) => {
    if (!activeIds.has(claimId)) throw new Error(`Claim ${claimId} is not active in ACTIVE_MANIFEST`);
    const card = allCards.find((item) => item.claimId === claimId);
    if (!card) throw new Error(`Claim ${claimId} is missing from claim-cards.json`);
    if (card.status !== "ACTIVE" || card.publicationDisposition !== "PUBLIC_SAFE") {
      throw new Error(`Claim ${claimId} is not publishable`);
    }
    if (!card.allowedAudiences.includes(audienceLayer)) {
      throw new Error(`Claim ${claimId} is not allowed for audience ${audienceLayer}`);
    }
    return card;
  });
  const sourceManifest = JSON.parse(sourceBytes.toString("utf8")) as {
    sources?: Array<{ sourceId: string; binaryHash: string }>;
  };
  const hashesById = new Map((sourceManifest.sources ?? []).map((item) => [item.sourceId, item.binaryHash]));
  const sourceHashes = [...new Set(selectedCards.flatMap((card) => card.evidenceRefs).map((sourceId) => {
    const hash = hashesById.get(sourceId);
    if (!hash) throw new Error(`Evidence source ${sourceId} is not active in the source manifest`);
    return hash;
  }))].sort();
  const conflicts = (JSON.parse(conflictBytes.toString("utf8")) as unknown[]).map((item) => KnowledgeConflictSchema.parse(item));
  knowledgeSnapshot = createKnowledgeSnapshot({
    missionId: mission.id as string,
    organizationId: mission.organizationId as string,
    createdBy: mission.createdBy as string,
    traceId: mission.traceId as string,
    sourceHashes,
    claimCards: selectedCards,
    conflicts,
    audienceLayer,
    publicationScope: preflight.publicationScope,
    canonVersion,
  });
}

const draftGateReady = !preflight.requiresEnterpriseKnowledge || Boolean(knowledgeSnapshot);
if (draftGateReady) {
  assertDraftGate({ preflight, perspective, ...(knowledgeSnapshot ? { knowledgeSnapshot } : {}) });
}
const output = resolve(outputFile);
await mkdir(dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}-${randomUUID()}`;
const gate = {
  status: draftGateReady ? "READY" : "WAITING_KNOWLEDGE",
  preflight,
  perspective,
  ...(knowledgeSnapshot ? { knowledgeSnapshot } : {}),
};
await writeFile(temporary, JSON.stringify(gate, null, 2) + "\n", "utf8");
try {
  await rename(temporary, output);
} catch (error) {
  if (!["EPERM", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  await writeFile(output, JSON.stringify(gate, null, 2) + "\n", "utf8");
  await rm(temporary, { force: true });
}
console.log(JSON.stringify({ status: gate.status, output }, null, 2));
