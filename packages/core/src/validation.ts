import type {
  ContentMission,
  ContentValidationResult,
  ContentVersion,
  RequestIdentity,
} from "@risen/content-contracts";
import { containsForbiddenDeliveryFields } from "./network-boundary.js";
import { protectSensitiveData } from "./data-protection.js";
import type { PolicyPort } from "./ports.js";
import { newId, nowIso } from "./utils.js";

export async function validateContentVersion(
  mission: ContentMission,
  version: ContentVersion,
  identity: RequestIdentity,
  policyPort: PolicyPort,
): Promise<ContentValidationResult> {
  const issues: ContentValidationResult["issues"] = [];
  const evidenceById = new Map(mission.evidence.map((item) => [item.id, item]));
  const now = Date.now();

  for (const claim of mission.claims) {
    if (!claim.factual) {
      continue;
    }

    const linkedEvidence = claim.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((item) => item !== undefined);
    const verifiedEvidence = linkedEvidence.filter((item) => item.verified);

    if (verifiedEvidence.length === 0) {
      issues.push({
        code: "UNSUPPORTED_CLAIM",
        severity: "BLOCKING",
        message: `Factual claim has no verified evidence: ${claim.statement}`,
        claimId: claim.id,
      });
    }

    for (const evidence of verifiedEvidence) {
      if (evidence.validUntil && Date.parse(evidence.validUntil) < now) {
        issues.push({
          code: "EXPIRED_EVIDENCE",
          severity: "BLOCKING",
          message: `Evidence is expired: ${evidence.title}`,
          claimId: claim.id,
          evidenceId: evidence.id,
        });
      }
      if (
        evidence.rights.status !== "CLEARED" ||
        (evidence.rights.expiresAt &&
          Date.parse(evidence.rights.expiresAt) < now)
      ) {
        issues.push({
          code: "RIGHTS_NOT_CLEARED",
          severity: "BLOCKING",
          message: `Evidence rights are not cleared: ${evidence.title}`,
          claimId: claim.id,
          evidenceId: evidence.id,
        });
      }
    }
  }

  const forbiddenFields = containsForbiddenDeliveryFields({
    version: {
      title: version.title,
      body: version.body,
      generationContextSnapshot: version.generationContextSnapshot,
    },
  });
  for (const path of forbiddenFields) {
    issues.push({
      code: "FORBIDDEN_PLATFORM_FIELD",
      severity: "BLOCKING",
      message: `Content domain object contains a forbidden platform field: ${path}`,
      path,
    });
  }

  const protectedOutput = protectSensitiveData({
    title: version.title,
    body: version.body,
    richBody: version.richBody,
  });
  for (const finding of protectedOutput.findings) {
    issues.push({
      code: "SENSITIVE_DATA",
      severity: "BLOCKING",
      message: `Content contains sensitive data category ${finding.category}`,
      path: finding.path,
    });
  }

  const policyResult = await policyPort.check(mission, version);
  for (const issue of policyResult.issues) {
    issues.push({
      code: issue.code,
      severity: "BLOCKING",
      message: issue.message,
      ...(issue.path ? { path: issue.path } : {}),
    });
  }

  const passed = issues.every((issue) => issue.severity !== "BLOCKING");
  const timestamp = nowIso();
  return {
    id: newId("validation"),
    organizationId: identity.organizationId,
    createdBy: identity.userId,
    traceId: version.traceId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: passed ? "PASSED" : "FAILED",
    assetId: version.assetId,
    versionId: version.id,
    issues,
    checks: {
      claims: !issues.some((item) => item.code === "UNSUPPORTED_CLAIM"),
      claimSemantics: true,
      evidence: !issues.some((item) => item.code === "EXPIRED_EVIDENCE"),
      brand: !issues.some((item) => item.code === "BRAND_RULE"),
      policy: !issues.some(
        (item) => item.code === "POLICY_RULE" || item.code === "MISSING_DISCLOSURE",
      ),
      rights: !issues.some((item) => item.code === "RIGHTS_NOT_CLEARED"),
      platformBoundary: !issues.some(
        (item) => item.code === "FORBIDDEN_PLATFORM_FIELD",
      ),
      dataProtection: !issues.some((item) => item.code === "SENSITIVE_DATA"),
    },
  };
}

export class RuleBasedPolicyPort implements PolicyPort {
  async check(
    mission: ContentMission,
    version: ContentVersion,
  ): Promise<Awaited<ReturnType<PolicyPort["check"]>>> {
    const issues: Awaited<ReturnType<PolicyPort["check"]>>["issues"] = [];
    const normalizedBody = version.body.toLocaleLowerCase();

    for (const rule of mission.brandRules) {
      if (rule.startsWith("FORBID:")) {
        const term = rule.slice("FORBID:".length).trim();
        if (term && normalizedBody.includes(term.toLocaleLowerCase())) {
          issues.push({
            code: "BRAND_RULE",
            message: `Forbidden brand term is present: ${term}`,
            path: "body",
          });
        }
      }
    }

    for (const policy of mission.policies) {
      if (policy.startsWith("REQUIRE_DISCLOSURE:")) {
        const disclosure = policy.slice("REQUIRE_DISCLOSURE:".length).trim();
        if (disclosure && !version.body.includes(disclosure)) {
          issues.push({
            code: "MISSING_DISCLOSURE",
            message: `Required disclosure is missing: ${disclosure}`,
            path: "body",
          });
        }
      }
      if (policy.startsWith("FORBID:")) {
        const term = policy.slice("FORBID:".length).trim();
        if (term && normalizedBody.includes(term.toLocaleLowerCase())) {
          issues.push({
            code: "POLICY_RULE",
            message: `Forbidden policy term is present: ${term}`,
            path: "body",
          });
        }
      }
    }

    return { passed: issues.length === 0, issues };
  }
}
