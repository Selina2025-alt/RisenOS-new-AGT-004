# DOMAIN_MODEL_V5.3

本分册只拆分 `IMPLEMENTATION_PLAN_V5.3.md` 的领域模型，不新增隐藏规则。

## 公共字段

所有业务对象：`id`、`organizationId`、`createdBy`、`traceId`、`createdAt`、`updatedAt`、`status`。

## 核心聚合

- `ContentMission`：任务目标、策略、受众、消息、渠道、Claims、Evidence、品牌规则、政策和附件快照。
- `AgentRun` / `AgentRunStep`：六阶段兼容执行记录与错误、输入/输出哈希。
- `ContentAsset` / `ContentVersion`：资产和不可变版本；版本保存父版本、变更原因、生成上下文、技能和 Claim 快照。
- `ContentResearch` / `ResearchGap` / `EvidenceRequest` / `Evidence`：研究、缺口、证据请求和证据。
- `Claim` / `ClaimBindingSnapshot`：事实声明和证据绑定。
- `ReviewRequest` / `ReviewReport` / `ReviewIssue`：审核请求、AI 味儿、逻辑、企业融合、SEO/GEO、合规和证据结果。
- `GeoSeoRequest` / `GeoSeoOptimizationProposal`：小点点输入、优化提案和技术建议。
- `VariantBrief` / `BalalaVariantPackage`：渠道变体输入、平台格式、继承绑定和轻量复核。
- `AssetBrief` / `GeneratedAsset`：视觉规划、图片、版权和扫描状态。
- `ContentPackage`：已审核版本、变体、资产、Evidence、CoverageMap 和哈希，不含平台字段。
- `SkillPackage` / `SkillVersion`：技能导入、测试、人工激活和版本。
- `PreferenceCandidate` / `PreferenceRule`：反馈候选、影子评估、人工批准和可回滚规则。
- `AgentTask` / `ArtifactRef` / `AgentCheckpoint`：内部协同任务、Artifact 和恢复点。

## 不可变要求

`ContentVersion`、`TopicSnapshot`、`ClaimBindingSnapshot`、`SkillTrace` 和交付哈希不可覆盖。修改必须创建新版本并重跑相关校验。

## 组织隔离

所有 Repository 查询、Artifact URI、任务和协议 Envelope 都必须携带 `organizationId`，跨组织读取必须失败。
