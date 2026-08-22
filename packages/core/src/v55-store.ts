import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  ClaimDecisionInputSchema,
  KnowledgeClaimCardSchema,
  KnowledgeConflictSchema,
  KnowledgeSnapshotSchema,
  MissionPreflightSchema,
  PerspectiveContractSchema,
  type ClaimDecisionInput,
  type KnowledgeClaimCard,
  type KnowledgeConflict,
  type KnowledgeSnapshot,
  type MissionPreflight,
  type PerspectiveContract,
} from "@risen/content-contracts";

import { ConflictError, NotFoundError } from "./errors.js";
import type { GovernanceGatePort } from "./ports.js";
import type { ContentMission } from "@risen/content-contracts";
import { assertDraftGate, assertKnowledgeSnapshotSourcesActive, validateNomosContent } from "./v55-governance.js";
import { nowIso } from "./utils.js";

interface V55StoreState {
  preflights: MissionPreflight[];
  perspectives: PerspectiveContract[];
  snapshots: KnowledgeSnapshot[];
  claimCards: KnowledgeClaimCard[];
  conflicts: KnowledgeConflict[];
}

export interface V55GovernanceRepository {
  load(): Promise<void>;
  seedKnowledge(claimCards: unknown[], conflicts: unknown[]): Promise<void>;
  saveMissionGate(preflight: MissionPreflight, perspective: PerspectiveContract, snapshot?: KnowledgeSnapshot): Promise<void>;
  getPreflight(missionId: string, organizationId: string): Promise<MissionPreflight | undefined>;
  getPerspective(missionId: string, organizationId: string): Promise<PerspectiveContract | undefined>;
  getSnapshot(missionId: string, organizationId: string): Promise<KnowledgeSnapshot | undefined>;
  getClaimCards(ids: string[], organizationId: string): Promise<KnowledgeClaimCard[]>;
  listConflicts(organizationId: string): Promise<KnowledgeConflict[]>;
  decideClaim(input: ClaimDecisionInput, organizationId: string): Promise<KnowledgeClaimCard>;
  close?(): Promise<void>;
}

const EMPTY_STATE: V55StoreState = {
  preflights: [],
  perspectives: [],
  snapshots: [],
  claimCards: [],
  conflicts: [],
};

export class V55GovernanceStore implements V55GovernanceRepository {
  private state: V55StoreState = structuredClone(EMPTY_STATE);
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly stateFile: string;

  public constructor(root: string) {
    this.stateFile = join(resolve(root), "governance-state.json");
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as V55StoreState;
      this.state = {
        preflights: parsed.preflights.map((item) => MissionPreflightSchema.parse(item)),
        perspectives: parsed.perspectives.map((item) => PerspectiveContractSchema.parse(item)),
        snapshots: parsed.snapshots.map((item) => KnowledgeSnapshotSchema.parse(item)),
        claimCards: parsed.claimCards.map((item) => KnowledgeClaimCardSchema.parse(item)),
        conflicts: parsed.conflicts.map((item) => KnowledgeConflictSchema.parse(item)),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async seedKnowledge(claimCards: unknown[], conflicts: unknown[]): Promise<void> {
    const cards = claimCards.map((item) => KnowledgeClaimCardSchema.parse(item));
    const parsedConflicts = conflicts.map((item) => KnowledgeConflictSchema.parse(item));
    const existingCards = new Map(this.state.claimCards.map((item) => [item.claimId, item]));
    for (const card of cards) if (!existingCards.has(card.claimId)) existingCards.set(card.claimId, card);
    const existingConflicts = new Map(this.state.conflicts.map((item) => [item.conflictId, item]));
    for (const conflict of parsedConflicts) if (!existingConflicts.has(conflict.conflictId)) existingConflicts.set(conflict.conflictId, conflict);
    this.state.claimCards = [...existingCards.values()];
    this.state.conflicts = [...existingConflicts.values()];
    await this.persist();
  }

  async saveMissionGate(preflight: MissionPreflight, perspective: PerspectiveContract, snapshot?: KnowledgeSnapshot): Promise<void> {
    this.assertSameOrganization(preflight.organizationId, perspective.organizationId);
    this.upsert("preflights", preflight, (item) => item.missionId === preflight.missionId);
    this.upsert("perspectives", perspective, (item) => item.missionId === perspective.missionId);
    if (snapshot) this.upsert("snapshots", snapshot, (item) => item.snapshotId === snapshot.snapshotId);
    await this.persist();
  }

  async getPreflight(missionId: string, organizationId: string): Promise<MissionPreflight | undefined> {
    return this.state.preflights.find((item) => item.missionId === missionId && item.organizationId === organizationId);
  }

  async getPerspective(missionId: string, organizationId: string): Promise<PerspectiveContract | undefined> {
    return this.state.perspectives.find((item) => item.missionId === missionId && item.organizationId === organizationId);
  }

  async getSnapshot(missionId: string, organizationId: string): Promise<KnowledgeSnapshot | undefined> {
    return this.state.snapshots.filter((item) => item.missionId === missionId && item.organizationId === organizationId && item.status === "ACTIVE").at(-1);
  }

  async getClaimCards(ids: string[], organizationId: string): Promise<KnowledgeClaimCard[]> {
    const requested = ids.map((id) => this.state.claimCards.find((item) => item.claimId === id && item.organizationId === organizationId));
    const missing = ids.filter((_, index) => !requested[index]);
    if (missing.length) throw new NotFoundError("KnowledgeClaimCard", missing.join(","));
    return requested as KnowledgeClaimCard[];
  }

  async listConflicts(organizationId: string): Promise<KnowledgeConflict[]> {
    return this.state.conflicts.filter((item) => item.organizationId === organizationId);
  }

  async decideClaim(input: ClaimDecisionInput, organizationId: string): Promise<KnowledgeClaimCard> {
    const decision = ClaimDecisionInputSchema.parse(input);
    const index = this.state.claimCards.findIndex((item) => item.claimId === decision.claimId && item.organizationId === organizationId);
    if (index < 0) throw new NotFoundError("KnowledgeClaimCard", decision.claimId);
    const current = this.state.claimCards[index]!;
    const status: KnowledgeClaimCard["status"] =
      decision.decision === "APPROVE" ? "ACTIVE" :
      decision.decision === "REJECT" ? "REJECTED" :
      decision.decision === "SUPERSEDE" ? "SUPERSEDED" : "CONFLICTING";
    const updated = KnowledgeClaimCardSchema.parse({
      ...current,
      status,
      approvedBy: decision.decision === "APPROVE" ? decision.decidedBy : current.approvedBy,
      updatedAt: nowIso(),
    });
    this.state.claimCards[index] = updated;
    await this.persist();
    return updated;
  }

  private upsert<K extends "preflights" | "perspectives" | "snapshots">(
    key: K,
    value: V55StoreState[K][number],
    predicate: (item: V55StoreState[K][number]) => boolean,
  ): void {
    const collection = this.state[key] as Array<V55StoreState[K][number]>;
    const index = collection.findIndex(predicate);
    if (index >= 0) {
      if (key === "snapshots") {
        throw new ConflictError("IMMUTABLE_KNOWLEDGE_SNAPSHOT", "KnowledgeSnapshot cannot be overwritten; block the old task and create a new mission gate");
      }
      collection[index] = value;
    } else {
      collection.push(value);
    }
  }

  private assertSameOrganization(left: string, right: string): void {
    if (left !== right) throw new ConflictError("ORGANIZATION_MISMATCH", "Governance objects must belong to the same organization");
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(this.state, null, 2) + "\n";
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.stateFile), { recursive: true });
      const temporary = `${this.stateFile}.tmp-${process.pid}-${randomUUID()}`;
      await writeFile(temporary, payload, "utf8");
      try {
        await rename(temporary, this.stateFile);
      } catch (error) {
        if (!["EPERM", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        await writeFile(this.stateFile, payload, "utf8");
        await rm(temporary, { force: true });
      }
    });
    await this.writeQueue;
  }
}

export class V55StoreGovernanceGate implements GovernanceGatePort {
  public constructor(
    private readonly store: V55GovernanceRepository,
    private readonly activeNomosSourceHashes: string[] = [],
  ) {}

  async assertMissionReady(mission: ContentMission): Promise<void> {
    const preflight = await this.store.getPreflight(mission.id, mission.organizationId);
    if (!preflight) throw new ConflictError("MISSION_PREFLIGHT_REQUIRED", "Mission Preflight must complete before execution");
    const perspective = await this.store.getPerspective(mission.id, mission.organizationId);
    const knowledgeSnapshot = await this.store.getSnapshot(mission.id, mission.organizationId);
    assertDraftGate({
      preflight,
      ...(perspective ? { perspective } : {}),
      ...(knowledgeSnapshot ? { knowledgeSnapshot } : {}),
    });
    if (preflight.requiresNomosPolicy && knowledgeSnapshot) {
      if (!this.activeNomosSourceHashes.length) {
        throw new ConflictError("NOMOS_CANON_NOT_LOADED", "Nomos source hashes are unavailable");
      }
      assertKnowledgeSnapshotSourcesActive(knowledgeSnapshot, this.activeNomosSourceHashes);
    }
  }

  async assertGeneratedContent(mission: ContentMission, content: string): Promise<void> {
    const preflight = await this.store.getPreflight(mission.id, mission.organizationId);
    if (!preflight) throw new ConflictError("MISSION_PREFLIGHT_REQUIRED", "Mission Preflight must complete before post-draft validation");
    if (!preflight.requiresNomosPolicy) return;
    const blockers = validateNomosContent(content).filter((issue) => issue.blocks);
    if (blockers.length) {
      throw new ConflictError("NOMOS_CONTENT_BLOCKED", blockers.map((issue) => issue.code).join(","));
    }
  }
}
