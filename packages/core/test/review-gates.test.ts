import { describe, expect, it } from "vitest";
import { reviewAiStyle, reviewLogic } from "../src/index.js";

describe("Lilith review gates", () => {
  it("flags clustered AI-style signals without detector evasion", () => {
    const report = reviewAiStyle("因此我们要重塑生态。同时我们要赋能组织。\n\n因此我们要构建新范式。同时我们要全面升级。\n\n因此我们要实现闭环。同时我们要引领变化。\n\n因此我们要重塑生态。同时我们要赋能组织。");
    expect(report.signalFamilies.length).toBeGreaterThanOrEqual(2);
    expect(report.humanizationGoal).toBe("specificity_readability_and_human_voice");
  });

  it("detects an abrupt enterprise insertion", () => {
    const report = reviewLogic("外部事件引发了行业讨论。\n\n艾氪智能 JovaAI 可以帮助企业。\n\n最后请结合情况判断。", ["艾氪智能", "JovaAI"]);
    expect(report.issues.some((item) => item.code === "FORCED_ENTERPRISE_INSERTION")).toBe(true);
  });
});

