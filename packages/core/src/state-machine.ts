import type { ContentStatus } from "@risen/content-contracts";
import { ConflictError } from "./errors.js";

const transitions: Readonly<Record<ContentStatus, readonly ContentStatus[]>> = {
  DRAFT: ["GENERATING", "ARCHIVED", "FAILED"],
  GENERATING: ["VALIDATING", "EVIDENCE_REQUIRED", "FAILED"],
  VALIDATING: ["EVIDENCE_REQUIRED", "REVIEW_REQUIRED", "REVISION_REQUIRED", "FAILED"],
  EVIDENCE_REQUIRED: ["VALIDATING", "GENERATING", "ARCHIVED", "FAILED"],
  REVIEW_REQUIRED: ["APPROVED", "REVISION_REQUIRED", "ARCHIVED", "FAILED"],
  REVISION_REQUIRED: ["GENERATING", "VALIDATING", "REVIEW_REQUIRED", "ARCHIVED", "FAILED"],
  APPROVED: ["PACKAGED", "REVISION_REQUIRED", "ARCHIVED"],
  PACKAGED: ["DELIVERED", "REVISION_REQUIRED", "ARCHIVED"],
  DELIVERED: ["REVISION_REQUIRED", "ARCHIVED"],
  ARCHIVED: [],
  FAILED: ["DRAFT", "GENERATING", "ARCHIVED"],
};

export function assertContentTransition(from: ContentStatus, to: ContentStatus): void {
  if (!transitions[from].includes(to)) {
    throw new ConflictError(
      "INVALID_CONTENT_TRANSITION",
      `Content status cannot transition from ${from} to ${to}`,
    );
  }
}

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return transitions[from].includes(to);
}
