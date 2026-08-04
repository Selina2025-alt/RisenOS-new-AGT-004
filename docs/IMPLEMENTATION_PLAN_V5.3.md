# AGT-RSN-004 内容资产持久化引擎 V5.3

> V5.3 汇总并替代 V4.0、V5.0、V5.1、V5.2。后续实现、测试、部署和验收只以本文件及其分册为准。

## 0. 命名和边界

“Campaign 持久化引擎”仅指内容任务与内容资产的全生命周期持久化，不新增 `Campaign`、`CampaignSchedule`、`PublishPlan` 或 `PublishTask` 业务域。

AGT-004 负责选题、研究、写作、审核编排、GEO/SEO 优化、渠道变体、视觉资产 Brief、版本、复用、导出和 ContentPackage 交付；不连接发布平台、不保存账号或平台状态、不采集效果、不生成 LearningProposal、不使用额外模型 API。

热点雷达只读取三条资讯任务生成的本地 `READY` 副本。

## 当前实现状态

本次落地已完成：

- V5.3 总文档及九个分册；
- `AgentDefinition`、`AgentTask`、`ArtifactRef`、`AgentCheckpoint`、`AgentLease` 和 GEO/SEO Proposal Schema；
- 本地有界 Agent Runtime：依赖、幂等、权限、取消、重试、租约、结果和本地事件持久化；
- Xiaodiandian GEO/SEO Proposal 组合与 Claim/Evidence 闸门；
- HostModel 新增审核、变体、Coverage 和 GEO/SEO Schema 名称；
- Lilith、Xiaodiandian、Balala Port 契约；
- 本地原子写入并发修复；
- Runtime、GEO/SEO、权限和持久化测试。

仍待后续阶段接入：

- Fastify Agent Task/GEO API 路由；
- Worker 中的生产 Agent Runtime 适配器；
- PostgreSQL/Redis/S3 的 AgentTask、Artifact、Checkpoint 和 GEO 表；
- 真实 HostRuntime 下的 Lilith、Xiaodiandian 和 Balala 调度；
- Preference Shadow Evaluation 和生产 OTel 指标；
- AI-Content-Factory 正式 dry-run 迁移。

本次版本提供可测试的本地协同内核和完整契约，不把尚未接入宿主或生产基础设施的能力宣称为已投入生产。

## 1. 部署形态

### 本地对话模式

```text
HostRuntime → Headless Content Core → Internal Agent Runtime → LocalFileRepository
```

不依赖前端、数据库、Redis、Docker；通过对话和 CLI 运行，所有 JSON、Markdown、图片、Artifact、Checkpoint 和审计数据保存于：

```text
AGT-RSN-004-Workspace/
  active_context.json  missions/  intelligence/  research/  drafts/
  review/  approved/  variants/  assets/  packages/  feedback/ audit/
  archive/  knowledge/  agents/  tasks/  checkpoints/  events/ artifacts/
  locks/  geo-seo/  evolution/
```

### 生产服务模式

```text
Next.js(optional) → Fastify API → Content Core → Agent Runtime
                 → PostgreSQL → Redis/BullMQ → S3/MinIO → HostRuntime
```

前端不是领域核心；生产和本地模式共享领域模型、Schema 和 Port。

## 2. 宿主模型

AGT-004 只调用宿主提供的：

```ts
interface HostRuntimeExecutor {
  generateObject<T>(request: GenerateObjectRequest): Promise<T>;
  generateText(request: GenerateTextRequest): Promise<string>;
  generateImage(request: GenerateImageRequest): Promise<GeneratedImage>;
}
```

Codex 使用 Codex 宿主模型，JovaAI 使用 JovaAI 宿主模型。宿主负责模型、凭据、安全、Token、超时、取消、结构化输出和图片能力。

模型失败必须进入 `FAILED`，不返回伪完成内容，不使用 Mock 或 Prototype Fallback。记录 `hostId`、`modelId`、`modelVersion`、`promptVersion`、Token、耗时和错误类型；不记录 Key、Token、Cookie、Authorization 或完整环境变量。

## 3. 智能体拓扑与权限

```text
004 Supervisor
  ├─ Research / Writing / Revision Worker
  ├─ Lilith Review Agent
  ├─ Xiaodiandian GEO/SEO Agent
  ├─ Balala Variant Agent
  └─ Packaging Worker
```

外部协作仅为：`AGT-003 → Evidence`、`AGT-004 → EvidenceRequest`、`AGT-006 → ReviewDecision`、`AGT-005 ← ContentPackage`。Lilith、Xiaodiandian、Balala 不加入外部 Agent Recipient。

| Agent | 允许 | 禁止 |
|---|---|---|
| 004 | 调度、研究、写作、修订、创建 ContentVersion、打包 | 自行批准、发布、效果监测、激活规则 |
| Lilith | AI 味儿、逻辑、合规、证据、企业融合、SEO/GEO 问题审核 | 直接写版本、GEO 实际改写、自我批准、改正式知识库 |
| Xiaodiandian | SEO/GEO 意图、问题覆盖、实体、答案块、可引用性、优化 Proposal | 新增无证据 Claim、直接写版本、平台监测、官网部署 |
| Balala | 微信、短视频、小红书、X、LinkedIn 变体和资产 Brief | 修改源版本 Claim/Evidence、绕过审核、直接打包 |

所有子智能体只输出 Report、Proposal 或 Variant Artifact；只有 004 创建正式 `ContentVersion`。

## 4. Internal Agent Runtime

```ts
interface InternalAgentRuntime {
  dispatch(task: AgentTask): Promise<TaskHandle>;
  await(taskId: string): Promise<TaskResult>;
  pause(taskId: string): Promise<void>;
  resume(taskId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
  retry(taskId: string, reason: string): Promise<void>;
}
```

`AgentDefinition` 必须保存：`agentId`、版本、角色、输入/输出 Schema、技能、允许/禁止工具、写版本/知识/技能权限、批准权限、并发、超时、重试、暂停能力、人工闸门和 `manifestHash`。

`AgentTask` 必须保存：`taskId`、`rootRunId`、父任务、Mission、组织、Trace、发送/接收 Agent、任务类型、Agent 版本、Skill 快照、Artifact 引用、输出 Schema、依赖任务、状态、优先级、尝试次数、截止时间、Checkpoint、幂等键、批准要求、租约和错误。

任务状态：

```text
QUEUED READY RUNNING WAITING_INPUT WAITING_EVIDENCE WAITING_REVIEW
WAITING_HUMAN SUCCEEDED FAILED BLOCKED CANCELLED EXPIRED
```

Runtime 支持 DAG、Fan-out、Join、租约、心跳、超时、暂停、取消、恢复、幂等和失败关闭。默认本地模型生成串行、变体最多并行两个；生产每 Mission 最多四个、每组织最多八个任务。瞬态错误最多自动重试两次；证据、政策、版权和权限错误不重试。

子智能体之间传 `ArtifactRef`，不复制完整上下文：`artifactId`、类型、Schema、Hash、URI、MIME、权益、创建者、来源、父 Artifact 和状态。

## 5. 持久化模型

所有业务对象包含：

```text
id organizationId createdBy traceId createdAt updatedAt status
```

核心对象：

```text
ContentMission AgentRun AgentRunStep ContentBatch
FeedRun SignalItem TopicCandidate TopicSnapshot
ContentBrief ContentResearch ResearchGap EvidenceRequest Evidence
Claim ClaimBindingSnapshot ContentAsset ContentVersion ChannelVariant
AssetBrief GeneratedAsset AssetRights ReviewRequest ReviewReport ReviewIssue
ContentCoverageMap VariantBrief BalalaVariantPackage ContentPackage
SkillPackage SkillVersion PreferenceRule AuditEvent AgentTask
AgentCheckpoint ArtifactRef GeoSeoRequest GeoSeoOptimizationProposal
```

### 不可变版本

`ContentVersion` 只能新增，不能 UPDATE/DELETE。每个新版本保存：

```text
parentVersionId contentHash changeReason changedBy
generationContextSnapshot generationMetadataSnapshot claimBindingSnapshot
```

已审核版本被修改后，原审核结果失效；新版本必须重新验证、审核和判断变体继承。

### 内容状态

```text
DRAFT → GENERATING → VALIDATING → EVIDENCE_REQUIRED
      → REVIEW_REQUIRED → REVISION_REQUIRED → APPROVED
      → PACKAGED → DELIVERED → ARCHIVED
```

任何阶段可进入 `FAILED`。`DELIVERED` 只表示内容包已交付，不表示已发布。

### 审核、变体和包状态

```text
REVIEW_PENDING → REVIEWING → REVISION_REQUIRED → RE_REVIEWING
                → APPROVED_FOR_VARIANTS

VARIANT_GENERATING → VARIANT_VALIDATING → LILITH_REVIEWING
                   → REVISION_REQUIRED → RE_REVIEWING
                   → HUMAN_REVIEW → APPROVED

PACKAGED → DELIVERED
```

P0/P1、无证据 Claim、无版权资产、未完成企业融合或审核失败不得进入包。

## 6. 热点和内容流程

### 热点雷达

三条资讯任务每次运行写：

```text
manifest.json items.json digest.md READY
```

先写临时目录，Schema 校验后原子改名，最后创建 `READY`。004 只读取完整运行目录。

日报流程：读取 READY → 时区统一 → URL 规范化 → 去重 → 中英文事件合并 → 聚类 → 可信门槛 → 三赛道评分 → 排名 → 报告 → 用户批准 → TopicSnapshot。

三赛道：

- 热点趋势：时效、来源数量、重复出现、信号热度、资料增长、企业影响；
- 名人/名企观点：身份、原始来源、观点清晰度、AI 相关性、可延展性、客户关联；
- 企业 AI/产业 AI：转型相关性、产业场景、艾氪智能关联、产品自然关联、证据和商业叙事。

必须输出 `score`、`scoreBreakdown`、`scoreConfidence`、`dataCoverage`、`sourceDiversity`、`freshnessWindow`、`evidenceStatus`、`riskWarnings`。信号热度不得描述成全网热度。资料不足时少报，不模板凑数。

### 用户指定选题

```text
用户主题 → Mission → 企业知识/合规 → 安全搜索词 → 公开研究
→ 去重/来源分级 → ResearchPack → ContentBrief → Outline → 长文
→ 莉莉丝 → 小点点（GEO/SEO问题）→ 004创建新版本 → 莉莉丝复审
→ 人工确认 → 巴啦啦变体 → 渠道校验 → 莉莉丝轻审 → ContentPackage
```

默认研究包：8–15 条有效资料、至少 2 条高权威/原始资料、至少 3 种来源类型、事实 Claim 逐条绑定来源。只保存摘要、短摘录、链接、时间和哈希。

## 7. 莉莉丝审核

### AI 味儿

检测连接词过密、破折号/冒号/括号过量、“不是而是”重复、三连排比、句长过度整齐、模板段落、抽象概念、缺少场景、缺少作者判断和空泛结尾。

```text
单一信号 INFO；两个信号族 WARN；三个以上跨段 P1；严重影响自然度 BLOCK
```

### 逻辑

```text
事件 → 事实 → 解释 → 企业问题 → 方法/产品 → 边界
```

检查主题跳跃、因果缺失、证据不支持、产品突然出现、结论越界、概念漂移、论点重复和企业融合生硬。

简单的标点、句拆分、连接词、排比和过渡建议可自动提出；新事实、产品能力、客户案例、证据、核心观点、企业定位和 GEO/SEO 改写必须路由给 004 或小点点。

## 8. 小点点 GEO/SEO

### 输入

`GeoSeoRequest` 包含源版本、审核、Brief、ResearchPack、正文、SEO/GEO 词库快照、Claim 绑定、偏好集、检查项和研究范围。

### 输出

`GeoSeoOptimizationProposal` 包含：

```text
primaryIntent secondaryIntents geoQuestionCoverage entityMap
answerBlocks seoEdits geoEdits evidenceGaps technicalRecommendations
newClaims riskWarnings requiresEvidenceRequest proposedRevisionText proposalHash
```

规则：每篇一个主意图、2–5 个次级意图；GEO 至少一个主问题和 2–4 个相关问题；每个事实回答绑定 Evidence；产品、案例和安全边界绑定正式知识或授权证据；不适合融合时输出“不宜融合”。

新 Claim 必须：

```text
ProposedClaim → ResearchGap → EvidenceRequest → Evidence → 004修订 → 莉莉丝复审
```

技术建议可包含 Article、Organization、FAQPage、HowTo、JSON-LD、FAQ、`llms.txt`、实体和内部链接，但仅为建议，不修改官网，不表示已完成部署。

同一源版本自动优化最多两轮，使用 `issueFingerprint`、`proposalHash`、`contentHash` 防止循环；超过两轮进入人工审核。

## 9. 巴啦啦变体

### 微信

深度解读，至少三个小标题；小标题格式 `前半句：后半句`，总长度不超过 13 个字符。输出标题候选、推荐标题、导语、正文、FAQ、证据说明、软 CTA 和配图 Brief。

### 短视频

输出标题、Hook、口播、时间段、镜头、字幕、证据位置、封面文案和软 CTA。默认 0–5 秒问题、5–20 秒重要性、20–60 秒机制/案例、60–100 秒企业场景、结尾边界判断。

### 小红书

轻内容固定 3 张：发生了什么、核心判断、企业/读者意义。

深度内容 5–9 张：封面、背景、事实、机制、争议/误区、企业场景、产品关联、边界、总结；按实际信息量选 5、7 或 9 张，不凑数。

### X

Thread；每条不超过 280 字符；首条必须有核心判断；重要 Claim 就近附来源；不能删除关键事实。

### LinkedIn

英文主稿、中文备稿、内容支柱、企业场景、执行任务、公开证据、企业启示、轮播 Brief、Alt Text 和标签。英文结构：Hook → Context → Task → Proof → Implication → JovaAI connection → Boundary → Soft CTA。中英文必须事实等价。

变体不得改变核心观点、Claim、Evidence、企业产品口径和覆盖图。实质改写必须重新完整审核；格式变化执行轻量审核。

## 10. Skill 和反馈

Skill 生命周期：

```text
IMPORTED → TESTING → READY → ACTIVE
```

必须做 Manifest、密钥/平台字段、Prompt Injection 和黄金样本回归检查，人工激活。每次运行保存 SkillTrace。

反馈流程：

```text
HumanFeedback → FeedbackNormalization → PreferenceCandidate
→ Golden Replay → Shadow Evaluation → 人工确认 → PreferenceRule → 回滚点
```

正式规则必须包含适用条件、排除条件、渠道、内容类型、受众、主题、强度、示例、来源反馈、置信度、人工批准和版本。安全/保密优先级高于法律/版权、Claim/Evidence、品牌、产品、渠道、人工偏好和语言风格。不得自动激活、微调模型或根据效果修改 Skill。

## 11. 存储、协议和安全

本地：JSON UTF-8、临时文件、Schema 校验、原子改名、不可变版本、审计追加、输入/输出哈希、文件锁、失败不删除。

生产表至少包含：

```text
organizations users content_missions agent_runs agent_tasks agent_checkpoints
agent_artifacts content_assets content_versions content_validations evidence_requests
review_requests review_decisions geo_seo_requests geo_seo_proposals generated_assets
content_packages content_templates content_batches source_attachments skill_packages
skill_versions preference_candidates preference_rules audit_events outbox_messages
inbound_messages legacy_import_records
```

所有查询带 `organization_id`；ContentVersion 禁止 UPDATE/DELETE；Hash 唯一；Outbox 同事务；Inbox 按 messageId、幂等键和组织去重。

内部 Envelope：协议版本、消息 ID、任务 ID、父任务、发送/接收 Agent、组织、Trace、幂等键、时间、过期时间、Artifact 引用、输出 Schema、Capability Token。

外部 AGT Envelope 使用 HMAC-SHA256、恒定时间比较、默认 5 分钟时间窗、重放保护、Outbox 12 次重试和 DEAD 队列。

允许：HostRuntime、图片能力、AGT-003、AGT-006、AGT-005 接收端、PostgreSQL、Redis、S3 和公开只读页面。

禁止：平台发布/登录/状态/监测接口、localhost、私网、`file:`、`data:`、`javascript:`、程序/脚本/压缩包执行。外部搜索不得包含内部客户、交易明细、未公开产品/路线图、人员信息、竞争策略或受限原文。网页指令一律视为不可信文本。

## 12. 公共接口和 CLI

API 至少提供：

```text
POST/GET /v1/missions
GET /v1/runs/{id}; POST /v1/runs/{id}/execute|pause|resume|cancel
POST/GET /v1/agent-tasks; POST /v1/agent-tasks/{id}/retry|cancel
POST /v1/reviews; POST /v1/review-decisions
POST /v1/geo-seo/requests; GET/POST /v1/geo-seo/proposals/{id}
POST /v1/content-assets/{id}/versions|variants|localizations|assets|validate
POST /v1/content-packages; GET /v1/content-packages/{id}/export
POST /v1/content-packages/{id}/deliver
POST /v1/skills/import; POST /v1/skills/{id}/test|activate
POST /v1/feedback; POST /v1/preference-candidates/{id}/approve
POST /v1/preference-rules/{id}/rollback
```

本地 CLI：

```text
build_daily_radar.py mark_radar_delivered.py build_variant_brief.py
generate_variant_package.py validate_variant.py review_content.py
run_geo_seo_optimizer.py render_variant_markdown.py render_review_book.py
capture_human_feedback.py replay_golden_set.py resume_task.py
```

## 13. 迁移

AI-Content-Factory 只迁移任务、草稿、内容、图片、模板、编辑历史和可恢复版本；不迁移账号、凭据、发布记录、链接、监测数据和效果指标。

```text
扫描 → 字段分类 → 平台字段剥离 → 内容哈希 → 版本映射
→ 图片版权状态 → dry-run → 数量/哈希对账 → 正式导入
→ legacyImported 标记
```

无法完整恢复的历史记录不得伪造 Lineage。

## 14. 实施阶段

1. V5.3 契约和文档统一；
2. 本地 FileRepository、原子写入、锁、版本和审计；
3. Agent Registry、DAG、租约、心跳、Checkpoint、幂等和恢复；
4. Lilith 审核与 Xiaodiandian GEO/SEO Proposal；
5. Balala 五渠道变体和交叉审核；
6. 反馈候选、黄金样本、影子评估和回滚；
7. HostRuntime、PostgreSQL、Redis、S3、OPA、OIDC、HMAC、OTel、备份和 UAT。

## 15. 测试和验收

必须测试 Schema、状态机、权限、DAG、租约、Checkpoint、幂等、不可变版本、Claim/Evidence、GEO Proposal、渠道结构、SkillTrace、反馈规则、版权和网络边界。

必须回放人物观点、企业 AI、产业案例、产品关联、不宜植入、GEO 缺口、过短、AI 味儿明显、公众号、小红书、X 和 LinkedIn 样本。

验收必须满足：本地模式不依赖外部 API；模型失败不产生伪完成；GEO 问题自动路由小点点；小点点不能写正式版本；莉莉丝不能自我批准；两轮后进入人工；公众号至少三个小标题；小红书轻内容 3 张、深度 5–9 张；X 通过 280 字符校验；LinkedIn 双语等价；变体继承 Claim/Evidence；清权资产才能打包；ContentPackage 无平台字段；所有过程可由 Trace 重建；跨组织泄漏和 P0 问题为零。

## 16. 默认决策

V5.3 是唯一实施依据；Campaign 不新增业务域；004 是 Supervisor；Lilith 只审核；Xiaodiandian 只做内容 GEO/SEO；Balala 只做变体；子智能体不能写正式版本或批准；只使用宿主模型；不做平台效果监测；GEO 技术建议不代表已部署；自动优化最多两轮；初期全部人工确认；反馈先候选/影子评估；第三方 Skill 先审查再激活；低于 2,000 星的 GEO 项目不进入生产依赖。
