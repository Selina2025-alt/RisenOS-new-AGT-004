# AGT-RSN-004 Domain Model V4.0

本分册展开 `IMPLEMENTATION_PLAN_V4.0.md` 的领域模型、字段约束和关系，不引入额外规则。

## 对象关系

```text
ContentMission 1─N AgentRun
ContentMission 1─1 ContentAsset
ContentAsset 1─N ContentVersion
ContentVersion 1─N ChannelVariant
ContentVersion 1─N GeneratedAsset
ContentMission 1─N Claim
Claim N─N Evidence
ContentVersion 1─N ReviewRequest
ReviewRequest 1─1 ReviewDecision
ContentAsset 1─N ContentPackage
ContentPackage 1─N HandoffReceipt
```

## 不可变和哈希

- `ContentVersion` 只允许 INSERT；禁止 UPDATE/DELETE。
- `parentVersionId` 必须指向同一 `organizationId` 的已有版本。
- `contentHash` 为规范化正文、标题、Claim 绑定和版本元数据的 SHA-256。
- 变体必须保存 `derivedFromVersionId`、源审核 ID 和继承快照。
- 研究包、雷达输入、PreferenceRule 和 SkillVersion 都保存输入/内容 hash。

## Claim/Evidence 约束

- factual Claim 至少有一条 verified Evidence 才能进入 APPROVED。
- Evidence 过期、权利受限或来源角色为线索时不能支撑最终事实表述。
- 修改 Claim statement 后必须重新计算 `statementHash` 并重新绑定 Evidence。
- 客户案例、产品能力、公开数据和专家背书必须分别核查授权和来源。

## ReviewReport 关键结构

审核报告必须同时输出完整度、企业融合、SEO、GEO、证据、合规、AI 味儿、逻辑、信息密度和 Skill 交叉结果。每个问题包含位置、原文、原因、证据、建议、是否可自动修复和是否阻断变体。

## BalalaVariantPackage 继承

巴啦啦不得丢失：`sourceContentVersionId`、`sourceReviewId`、Claim/Evidence 映射、CoverageMap、SkillTrace、企业融合结论、版权限制和 TraceId。变体改变事实、产品能力、证据或核心观点时必须重新完整审核。
