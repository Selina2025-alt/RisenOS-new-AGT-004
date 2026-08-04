export type BalalaXhsMode = "LIGHT_3_CARD" | "DEEP_5_9_CARD";

export interface BalalaVariantBrief {
  agent: "balala";
  variantType: string;
  variantMode?: BalalaXhsMode;
  targetChannels: string[];
  sourceContentVersionId: string;
  sourceReviewId: string;
  platformPolicyVersion: string;
  ctaPolicy: "soft";
}

export function chooseXhsMode(input: { depth?: "light" | "deep"; researchCount?: number; hasMultipleClaims?: boolean }): BalalaXhsMode {
  if (input.depth === "deep" || (input.researchCount ?? 0) >= 5 || input.hasMultipleClaims) return "DEEP_5_9_CARD";
  return "LIGHT_3_CARD";
}

export function buildBalalaVariantBrief(input: Omit<BalalaVariantBrief, "agent" | "ctaPolicy"> & { ctaPolicy?: "soft" }): BalalaVariantBrief {
  return { ...input, agent: "balala", ctaPolicy: "soft" };
}

export function validateXhsCards(mode: BalalaXhsMode, cards: readonly unknown[]): { ok: boolean; min: number; max: number; reason?: string } {
  const [min, max] = mode === "LIGHT_3_CARD" ? [3, 3] : [5, 9];
  return cards.length >= min && cards.length <= max
    ? { ok: true, min, max }
    : { ok: false, min, max, reason: `${mode} requires ${min}-${max} cards` };
}

export function xCharacterCount(value: string): number {
  return value.length + [...value.matchAll(/https?:\/\/[^\s]+/g)].reduce((total, match) => total + 23 - match[0].length, 0);
}

export function validateXTweet(value: string, maximum = 280): { ok: boolean; count: number; maximum: number } {
  const count = xCharacterCount(value);
  return { ok: count <= maximum, count, maximum };
}

