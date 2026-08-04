import { describe, expect, it } from "vitest";
import { chooseXhsMode, validateXhsCards, validateXTweet } from "../src/index.js";

describe("Balala channel contracts", () => {
  it("uses three cards for light content and 5-9 for deep content", () => {
    expect(chooseXhsMode({ depth: "light" })).toBe("LIGHT_3_CARD");
    expect(chooseXhsMode({ depth: "deep", researchCount: 8 })).toBe("DEEP_5_9_CARD");
    expect(validateXhsCards("LIGHT_3_CARD", [{}, {}, {}]).ok).toBe(true);
    expect(validateXhsCards("DEEP_5_9_CARD", [{}, {}, {}, {}, {}]).ok).toBe(true);
  });

  it("checks X using the host-independent 280-character fallback", () => {
    expect(validateXTweet("short").ok).toBe(true);
    expect(validateXTweet("x".repeat(281)).ok).toBe(false);
  });
});

