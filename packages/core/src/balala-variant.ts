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

const xUrlPattern = /https?:\/\/[^\s]+/g;

function xCodePointWeight(codePoint: number): number {
  // X's weighted-length rules count most Latin text as 1 and CJK/emoji as 2.
  // These ranges mirror the single-weight ranges published by twitter-text.
  if (
    (codePoint >= 0x0000 && codePoint <= 0x10ff) ||
    (codePoint >= 0x2000 && codePoint <= 0x200d) ||
    (codePoint >= 0x2010 && codePoint <= 0x201f) ||
    (codePoint >= 0x2032 && codePoint <= 0x2037)
  ) return 1;
  return 2;
}

function xTextWeight(value: string): number {
  return [...value.normalize("NFC")].reduce((total, character) => total + xCodePointWeight(character.codePointAt(0) ?? 0), 0);
}

export function xCharacterCount(value: string): number {
  let weightedLength = 0;
  let cursor = 0;
  for (const match of value.matchAll(xUrlPattern)) {
    const index = match.index ?? cursor;
    weightedLength += xTextWeight(value.slice(cursor, index));
    weightedLength += 23;
    cursor = index + match[0].length;
  }
  return weightedLength + xTextWeight(value.slice(cursor));
}

export function validateXTweet(value: string, maximum = 280): { ok: boolean; count: number; maximum: number } {
  const count = xCharacterCount(value);
  return { ok: count <= maximum, count, maximum };
}

