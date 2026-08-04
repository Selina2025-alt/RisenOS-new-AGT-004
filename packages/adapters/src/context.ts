import type { ContentMission } from "@risen/content-contracts";
import type { ContextPort } from "@risen/content-core";

export class EmbeddedContextPort implements ContextPort {
  async resolveMissionContext(
    mission: ContentMission,
  ): Promise<Record<string, unknown>> {
    return {
      strategy: mission.strategy,
      audience: mission.audience,
      message: mission.message,
      contentPlan: mission.contentPlan,
      claims: mission.claims,
      evidence: mission.evidence,
      brandRules: mission.brandRules,
      policies: mission.policies,
    };
  }
}
