# 莉莉丝写前独立审核报告

## 审核信息

- Review ID：`LILITH-PRE-DRAFT-SERIES-20260822-001`
- Series ID：`SERIES-20260822-INDUSTRIAL-AI`
- 审核阶段：写前审核
- 审核角色：莉莉丝（只读审核，不写正文，不批准）
- 审核结论：`REVISION_REQUIRED`
- 正式写作闸门：`BLOCKED`
- 问题统计：P0 = 0，P1 = 8，P2 = 3，P3 = 0

## 一、总体结论

系列的选题逻辑、官方视角、五篇差异化、企业融合边界、AI 员工责任边界和 Nomos 非机械植入原则总体成立。现有研究包没有发现直接的事实性 P0 问题，也没有把“看得见的价值”伪造成已实现 ROI。

当前不能进入正式写作，主要原因不是文案质量，而是 Topic、Brief、Knowledge、Research 之间尚未形成不可变的一一绑定，知识快照仍未激活，关键产品称谓、AI 员工术语、Nomos 分配和研究覆盖例外尚未完成闸门决定。若直接动笔，存在串稿、错用知识、产品口径漂移和将候选概念写成正式口径的风险。

## 二、已通过检查

1. **官方视角一致**：说话者为艾氪智能官方，目标受众和克制、专业的表达基调一致；未使用创始人个人经历或客户第一人称。
2. **五篇主叙事可区分**：已形成“落地问题 → 战略选择 → 系统条件 → 组织关系 → 企业行动”的系列递进，具备去重基础。
3. **价值表达边界基本正确**：“看得见的价值”当前被定义为评估与判断方法，没有被写成既成 ROI 或统一效果承诺。
4. **AI 员工责任边界基本正确**：未将 AI 员工写成法律意义的员工、独立责任主体或对人的替代；保留了人的授权、知情和最终决策权。
5. **Nomos 架构边界正确**：未把 Nomos 写成 JovaAI 第六层；当前方案允许“不宜融合”，没有要求每篇机械植入。
6. **研究来源使用克制**：研究包能区分事实、观点、政策和厂商材料，未把外部材料当作艾氪智能产品能力或客户效果证据。
7. **基础完整性通过**：17/17 企业知识来源哈希与登记一致；5/5 Research Pack 内容哈希与 manifest 一致；共 16 个去重来源。

## 三、P1 阻断问题

### P1-001：Topic 与 Brief/Knowledge 编号错位

- 模块：`task_binding`
- 精确位置：`topics/`、`briefs/`、`knowledge/proposals/`
- 问题：Topic/Mission 001 是“为什么聚焦实体产业”，而 Brief/Knowledge 01 是“AI 演示好但落地难”；Topic/Mission 002 与 Brief/Knowledge 02 反向错位。`publicationOrder=[2,1,3,4,5]` 只描述发布顺序，不能替代 Artifact 绑定。
- 风险：研究、知识和 Brief 被绑定到错误选题，造成串稿。
- 要求：为每个不可变 Topic ID 增加显式 `artifactBindings`，或将 Brief、Knowledge、Research 文件统一按 Topic ID 命名。
- 路由：004
- 自动修复：否

### P1-002：缺少不可变的人工作出决定

- 模块：`perspective_consistency`
- 精确位置：`perspective-input.json`、各 Gate
- 问题：Perspective 中虽有 `confirmedBy/confirmedAt`，但缺少 `HumanGateDecision` 的 `decisionId`、Artifact Hash 和幂等键。
- 风险：内容变化后，旧确认无法被可靠判定失效。
- 要求：建立绑定 Perspective Artifact Hash 的 `PERSPECTIVE_CONFIRMED` 决定。
- 路由：004 + 人工
- 自动修复：否

### P1-003：KnowledgeSnapshot 尚未激活并逐题挂载

- 模块：`knowledge_snapshot`
- 精确位置：`knowledge/knowledge-snapshot.json`、`knowledge/source-manifest.json`、5 个 Gate
- 问题：当前只有系列级知识快照提案，`activationStatus=NOT_ACTIVATED`；各 Gate 仍为 `WAITING_KNOWLEDGE`，Mission 仍为 `WAITING_PREFLIGHT`。
- 风险：写作时无法证明具体文章使用了哪一版正式知识。
- 要求：完成冲突处理和人工激活，为每个 Topic 生成或挂载不可变 KnowledgeSnapshot。
- 路由：玛卡巴卡 + 004 + 人工
- 自动修复：否

### P1-004：缺少逐题 Claim—Evidence 合并计划

- 模块：`claim_status/evidence`
- 精确位置：5 个 Research Pack 与 Knowledge Proposal 之间
- 问题：外部 `EXT-*` Claim 与内部 `S*-A*` Claim 尚未合并为逐题 `ClaimEvidencePlan`，也未绑定目标段落和允许用途。
- 风险：外部材料可能被误用为产品证明，内部战略观点可能被误写成公开事实。
- 要求：每篇建立结构化 Claim—Evidence 表，记录 Claim 类型、来源、目标段落、允许措辞、限制和证据缺口。补齐 SourceMaterial 元数据：`retrievedAt/contentHash/accessStatus/rightsStatus/authorityTier/verificationStatus/qualityWarnings`。
- 路由：依古比古 + 玛卡巴卡 + 004
- 自动修复：否

### P1-005：Topic 3 的品牌和架构称谓未冻结

- 模块：`product_architecture/nomos_canon`
- 精确位置：Topic 3 Perspective、Brief、Knowledge Proposal
- 问题：Perspective 写为 `brandNaming=NOT_APPLICABLE`，但正文计划需要使用 JovaAI、JovaOS、JovaAI OS、ICB、Nomos；其关系尚有未冻结口径。
- 风险：将技术架构、产品组合和品牌名称混为一体。
- 要求：只使用已确认安全称谓，或先完成 `KNOWLEDGE_CONFLICT_DECIDED`，明确每个名称的公开层级、使用场景和禁止组合。
- 路由：玛卡巴卡 + 人工
- 自动修复：否

### P1-006：Topic 4 的“AI 员工/硅基人才”术语边界未完成确认

- 模块：`compliance/claim_status`
- 精确位置：Topic 4 Brief 与 Knowledge Proposal
- 问题：“AI 员工”是官网表达，“硅基人才”仍是候选隐喻；尚缺公开定义和责任边界确认。
- 风险：被理解为法律劳动关系、人员替代或智能体独立承担责任。
- 要求：人工确认主术语与免责声明；明确其为角色化能力表达，不是法律身份，不能替代人或成为独立责任主体。
- 路由：玛卡巴卡 + 人工
- 自动修复：否

### P1-007：Nomos 跨篇分配尚未决定

- 模块：`enterprise_fusion/nomos_canon`
- 精确位置：Topic 1、3、4 的 Brief/Knowledge Proposal
- 问题：三个选题均保留 Nomos 可选融合，但系列规则最多两篇，尚无归属决定。
- 风险：多篇重复植入，造成叙事机械化和信息同质化。
- 要求：建议 Topic 3 作为主融合，Topic 4 仅在责任机制确需解释时作为第二篇，Topic 1 默认不植入；由人工确认 `ENTERPRISE_FUSION_CONFIRMED`。
- 路由：玛卡巴卡 + 人工
- 自动修复：否

### P1-008：研究覆盖未达到默认长文标准且无例外决定

- 模块：`content_adequacy/evidence`
- 精确位置：5 个 Research Pack
- 问题：各题来源数为 4、4、6、5、6，均低于默认 8–15 条有效资料目标，且没有 `coverageException`。Topic 1 偏政策来源；Topic 3 偏政策/厂商；Topic 4 缺少中国语境下的责任与授权材料。
- 风险：文章可能结构完整但证据面过窄。
- 要求：只补有明确缺口的定向资料，不进行无边界批量搜索；或由人工基于文章范围批准 `RESEARCH_COVERAGE_ACCEPTED`。
- 路由：依古比古 + 人工
- 自动修复：否

## 四、P2 优化项

1. **时间窗口统一**：Topic 5 同时出现“未来三年”和“未来两三年”。建议统一为一个规划窗口，并保持为判断框架，不写成确定性预测。
2. **共享来源去重**：`PUB-004` 被四篇复用，`PUB-002` 被三篇复用。应为每篇指定不同的证据用途，避免相同材料生成重复段落。
3. **案例闸门按条件触发**：Topic 1 当前 `requiresCasePolicy=true`，但案例不是必需项。建议仅在使用 L4 企业融合、真实案例或量化结果时激活，避免无必要阻断。

## 五、逐题决定

| Topic | 决定 | 主要原因 | 解锁条件 |
|---|---|---|---|
| 001 为什么聚焦实体产业 | `REVISION_REQUIRED` | Artifact 编号错位、知识快照未激活、Claim 计划缺失 | 修复绑定；明确“实体产业/看得见价值”为操作性定义；完成快照与证据计划 |
| 002 AI演示好但落地难 | `REVISION_REQUIRED` | Artifact 编号错位、知识快照和 Claim 计划缺失 | 修复绑定；完成逐题快照与证据计划 |
| 003 产业级 AI 的系统条件 | `BLOCKED` | 品牌、产品和五层架构称谓未冻结 | 完成知识冲突决定和架构状态矩阵 |
| 004 AI员工与组织关系 | `BLOCKED` | “AI员工/硅基人才”公开定义及责任边界未确认 | 完成术语决定、责任免责声明和必要补证 |
| 005 企业未来行动路线 | `REVISION_REQUIRED` | 时间窗口不一致、快照和 Claim 计划缺失 | 统一时间窗口；完成快照与证据计划 |

## 六、必须建立的人工闸门

1. `PERSPECTIVE_CONFIRMED`：绑定 Perspective Artifact Hash。
2. `KNOWLEDGE_CONFLICT_DECIDED`：解决品牌名称、架构和术语冲突。
3. `ENTERPRISE_FUSION_CONFIRMED`：确认 Nomos 在系列中的篇目分配。
4. `RESEARCH_COVERAGE_ACCEPTED`：确认定向补证完成或批准覆盖例外。
5. `SOURCE_DRAFT_APPROVED`：源稿完成完整审核后才能生成变体。
6. `FINAL_VARIANTS_APPROVED`：变体批准后才能打包。

## 七、建议恢复顺序

```text
修复 Topic—Artifact 一一绑定
→ 写入不可变 Perspective HumanGateDecision
→ 激活并逐题挂载 KnowledgeSnapshot
→ 解决 Topic 3/4 口径冲突
→ 决定 Nomos 篇目分配
→ 建立逐题 ClaimEvidencePlan
→ 定向补证或批准覆盖例外
→ 莉莉丝复核 Gate
→ 才允许唔西迪西生成 DraftProposal
```

## 八、莉莉丝最终闸门声明

本报告没有修改任何源材料、Brief、Knowledge、Research 或 ContentVersion；没有生成正文；没有批准 Perspective、源稿或变体。当前只允许继续完善结构、知识和证据绑定，不允许进入正式写作。
