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

  it("does not treat claim identifiers or structured method lists as AI-style dashes and tricolons", () => {
    const report = reviewAiStyle("身份边界：每个Agent都有权限。 [C-MODAL-001]\n\n数据边界：按任务开放。 [C-MODAL-002]\n\n网络边界：限制出口。\n\n责任边界：高风险动作人工确认。 [C-MODAL-003]");
    expect(report.signalFamilies).not.toContain("dash_density");
    expect(report.signalFamilies).not.toContain("parallelism");
  });

  it("recognizes an enterprise bridge and an actionable boundary without formulaic connectors", () => {
    const report = reviewLogic("外部事件暴露了Agent连续行动带来的企业治理问题，企业需要先检查权限、数据和网络出口。\n\n艾氪智能关注的是怎样把任务、权限和人工责任组织起来。\n\n部署前先问：谁能批准高风险动作，出了问题能否还原？", ["艾氪智能"]);
    expect(report.status).toBe("PASS");
  });
});

