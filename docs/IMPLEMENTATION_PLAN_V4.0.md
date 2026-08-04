# AGT-RSN-004 内容资产持久化引擎最终实施方案 V4.0

> 本文件是 AGT-RSN-004 的唯一实施基线。V1.0–V3.0 仅作为历史记录，实施、测试、部署和验收不再依赖前置版本。

## 1. 范围与边界

AGT-RSN-004 是纯内容域智能体，输入任务、策略、受众、Message、Claim、Evidence、BrandRule、Policy 和 ContentPlan，输出经过研究、生成、审核、版本化和权利校验的内容资产。

负责：选题深化、ContentBrief、ContentResearch、Outline、长短内容、公众号、短视频、小红书、X/Twitter、LinkedIn 变体、Localization、AnswerBlock、MediaPitch、PublicStatement 草稿、企业/产品自然融合、Claim/Evidence、品牌/政策/版权检查、版本/Lineage、视觉 Brief、Skill 管理、审核提交、ContentPackage 和下游交付。

不负责：平台接口、账号/Token/Cookie、发布/预约/撤回、PublishTask、平台内容 ID/链接、发布状态、曝光互动转化、效果归因、LearningProposal、市场/竞品/平台监测。每日热点雷达只读取三条资讯任务写入的本地 READY 结果。

V4 不新增 Campaign、CampaignSchedule 或发布计划领域对象；“持久化引擎”只指内容任务、研究、证据、版本、审核、变体、资产、反馈、内容包和审计记录的持久化。

## 2. 两种运行配置

### 2.1 本地对话模式

无前端、无数据库、无 Redis、无 Docker。Headless Content Core 通过 `LocalFileRepository` 保存 JSON、Markdown 和资产文件，使用当前宿主模型能力，适合 Codex 对话内人工研究、写作、审核和反馈。

目录：

```text
AGT-RSN-004-Workspace/
  active_context.json
  missions/ intelligence/ research/ drafts/ review/
  approved/ variants/ assets/ packages/ feedback/ audit/
  archive/ knowledge/
```

所有本地写入均采用临时文件、Schema 校验、原子改名和最终 READY 标记；版本只新增不覆盖，审计只追加不删除。

### 2.2 生产服务模式

```text
Next.js Web（可选） → Fastify API → Content Core
    → PostgreSQL Repository
    → Redis/BullMQ Worker
    → S3/MinIO
    → HostRuntime
```

生产组件：TypeScript Monorepo、Next.js、Fastify、Node Worker、PostgreSQL、Redis/BullMQ、S3/MinIO、OPA、OpenTelemetry 和宿主模型/图片适配器。前端是可选界面，不是领域核心。

## 3. 宿主模型与能力原则

AGT-004 不保存或配置第三方模型 API Key；模型由部署位置决定：Codex 使用 Codex 宿主模型，JovaAI 使用 JovaAI 宿主模型。领域层只依赖 `HostRuntimeExecutor.generateObject()`、可选的 `generateImage()`、附件上传/扫描/提取接口。

宿主必须返回：宿主 ID、模型 ID/版本、Prompt 版本、Token、耗时、安全状态、requestId、幂等键。宿主不可用、结构化输出失败或超时后，Run/Step 进入 FAILED，绝不返回 Mock、缓存样例或原型稿。

## 4. 领域对象与关系

### 4.1 通用字段

所有正式对象包含：`id`、`organizationId`、`createdBy`、`traceId`、`createdAt`、`updatedAt`、`status`。

### 4.2 任务、执行和批量

`ContentMission` 保存 `title/objective/strategy/audience/message/contentPlan/claims/evidence/brandRules/policies/requestedOutputs/channels/locales/highRisk/templateSnapshot/attachmentSnapshots/currentAssetId/failureReason`。

`AgentRun` 关联 Mission，包含六个 Step：`context/research/matching/writing/post_write/quality`，每个 Step 保存状态、开始/完成时间、错误和 metadata。`ContentBatch` 关联多个 Mission/Run，支持 QUEUED、RUNNING、PARTIAL、COMPLETED、FAILED、CANCELLED。

### 4.3 研究、热点和证据

`FeedRun`：`schemaVersion/feedId/runId/windowStart/windowEnd/collectedAt/status/errors/items/inputHash`。

`SignalItem`：`signalId/title/url/canonicalUrl/sourceName/sourceType/author/publishedAt/discoveredAt/summary/category/language/rawHeatSignals/sourceFeed/provenance/verificationStatus`。

`TopicCandidate`：`topicId/radarId/title/angle/whyNow/targetAudience/jovaaiConnection/recommendedFormats/score/scoreBreakdown/scoreConfidence/dataCoverage/sourceDiversity/freshnessWindow/supportSourceIds/evidenceStatus/riskWarnings/approvalStatus/snapshotHash`。

`TopicSnapshot` 是用户批准的不可变对象，保存 Topic、Radar、来源、评分拆解、证据状态、批准人、批准时间和 hash；日报更新不改变快照。

`ContentBrief`：`objective/audience/coreMessage/tone/deliverables/channels/locales/mustIncludeClaimIds/constraints/callToAction`。

`ContentResearch`：`summary/evidenceDigest/researchGaps`。

`Claim`：`statement/factual/evidenceIds/riskLevel`。

`Evidence`：`title/sourceType/sourceRef/excerpt/verified/verifiedBy/verifiedAt/validUntil/rights`。

`ClaimBindingSnapshot` 保存 `claimId/evidenceIds/statementHash`；事实 Claim 无验证 Evidence 不能 APPROVED。

`ResearchGap` 保存 Claim、问题、原因和 LOW/MEDIUM/HIGH 优先级。证据不足时只生成 `EvidenceRequest`，不得虚构来源。

### 4.4 内容、变体和资产

`ContentAsset` 关联 Mission、当前版本、全部版本、当前校验和当前审核。

`ContentVersion` 保存 `assetId/versionNumber/parentVersionId/title/body/bodyFormat/richBody/contentHash/changeReason/changedBy/generationContextSnapshot/generationMetadataSnapshot/claimBindingSnapshot`。版本禁止 UPDATE/DELETE。

`ChannelVariant` 保存 `channel/locale/title/body/summary/tags/claimIdsUsed/formatMetadata/derivedFromVersionId`。V4 的 `formatMetadata` 额外保存 `variantType/platformPolicyVersion/variantMode/contentDensity/aiStyleReviewId/logicReviewId/balalaTraceId/lilithReviewId`。

`AssetBrief` 保存 `assetType/purpose/prompt/aspectRatio/visualDirection/textOverlay/rightsRequired/derivedFromVersionId`；类型为 `cover/illustration/xiaohongshu_card/video_visual`。

`GeneratedAsset` 保存来源版本、Brief、URI、MIME、checksum 和 AssetRights。版权状态 UNKNOWN/PENDING/CLEARED/RESTRICTED/EXPIRED；非 CLEARED 资产不得打包。

### 4.5 审核、巴啦啦和覆盖图

`ReviewRequest` 保存 `assetId/versionId/reviewerType/reviewerId/notes/status`，V4 增加 `reviewAgent/requestedChecks/generationSkillTrace/applicablePreferenceSet`。

`ReviewReport` 包含：内容完整度、企业融合、SEO、GEO、Evidence、Compliance、AIStyle、Logic、信息密度、Skill 交叉检查、必须修改项、建议项、保留段落、修订稿、人工确认项和规则候选。

`ReviewIssue` 包含 `issueId/severity/module/location/originalText/problem/evidence/suggestion/autoFixable/blocksVariantGeneration`。

`VariantBrief` 保存源版本、源审核、研究包、ContentBrief、渠道、受众、语言、CTA、资产交付、CoverageMap、Claim 快照、SkillTrace、适用偏好和渠道策略版本。

`BalalaVariantPackage` 保存 `agent=balala`、渠道、语言、variantType、variantMode、copy、AssetBrief、继承的 Claim/Coverage、SkillTrace、自检、莉莉丝审核、hash 和状态。

`ContentCoverageMap` 保存 SEO 项、GEO 问题和实体提及；GEO 覆盖为 FULL/PARTIAL/MISSING。

### 4.6 Skill 与反馈

`SkillPackage` 保存名称、描述、状态、激活版本和版本列表；`SkillVersion` 保存语义版本、Manifest、Manifest Digest、安全回归、内容回归、批准人和状态。

Skill 生命周期：IMPORTED → TESTING → READY → ACTIVE；失败为 REJECTED，撤销为 RETIRED。

`PreferenceRule` 保存来源反馈、范围、适用条件、排除条件、强度、规则、示例、置信度、人工确认和版本。反馈生命周期：RawFeedback → PreferenceCandidate → 人工确认 → PreferenceRule → ApplicablePreferenceSet。

## 5. 状态机与不变量

### 5.1 内容

```text
DRAFT → GENERATING → VALIDATING → EVIDENCE_REQUIRED
  → REVIEW_REQUIRED → REVISION_REQUIRED → APPROVED
  → PACKAGED → DELIVERED → ARCHIVED
```

任何执行阶段可进入 FAILED；FAILED 只能回到 DRAFT/GENERATING 或 ARCHIVED。未验证事实 Claim、P0 合规问题、版权未清权、审核失败不能 APPROVED。

### 5.2 Run、Review、Variant、Package

Run：`QUEUED → RUNNING → WAITING_EVIDENCE/WAITING_REVIEW → COMPLETED`，运行中失败为 FAILED，排队任务可 CANCELLED。

Review：`REVIEW_PENDING → REVIEWING → REVISION_REQUIRED → RE_REVIEWING → APPROVED_FOR_VARIANTS`，严重问题进入 BLOCKED 或 REVIEW_FAILED。

Variant：`VARIANT_GENERATING → VARIANT_VALIDATING → LILITH_REVIEWING → REVISION_REQUIRED → RE_REVIEWING → HUMAN_REVIEW → APPROVED`。

Package：`PACKAGED → DELIVERED`。DELIVERED 只表示下游接收，不表示已发布。

任何变体修改事实、产品判断、核心观点、证据或企业定位，必须重新完整审核；仅格式和长度变化可轻量复核。

## 6. 生产流程

### 6.1 用户指定选题

```text
用户主题 → ContentMission → 企业知识/规则
→ 公开安全搜索词 → 研究/去重/来源分级
→ ResearchPack → ContentBrief → Outline
→ 004 长文 → 莉莉丝完整审核 → 004 修订 → 莉莉丝二审
→ 巴啦啦变体 → 巴啦啦自检 → 莉莉丝交叉审核
→ 巴啦啦修订 → 莉莉丝轻量复核 → ContentPackage
```

研究默认 8–15 条有效资料、至少 2 条高权威/原始资料、至少 3 类来源。只保存摘要、短摘录、链接、日期和 hash，不保存付费全文或完整字幕。

### 6.2 每日雷达

三条资讯任务只负责本地结构化输出。雷达读取 READY 目录后执行时区统一、URL 规范化、去重、中英文事件合并、聚类、可信门槛、三赛道评分和报告生成。资料不足时少报，不用模板凑数。用户批准后保存不可变 TopicSnapshot。

热点趋势、名人/名企观点、企业 AI/产业 AI 三个赛道分别评分；报告同时输出 score、scoreBreakdown、scoreConfidence、dataCoverage、sourceDiversity、freshnessWindow、evidenceStatus 和风险提示。信号热度不能表述为全网热度。

## 7. 莉莉丝审核规则

### 7.1 AI 味儿

检测连接词/总结词过密、破折号/冒号/括号过量、“不是……而是……”重复、三连排比、句长整齐、段落模板化、抽象概念过多、缺少场景和作者判断、元话语和空泛结尾。

单一信号为 INFO；两个信号族同段为 WARN；三个以上信号族跨段为 P1；严重影响自然度或逻辑为 BLOCK。引用、政策、技术定义、短视频口语和确认的品牌表达进入豁免。

AI 味儿审核的目标是提高具体性、可读性和真人判断，不是绕过检测器；禁止编造个人经历、错别字或不真实情绪。

### 7.2 逻辑

按“事件 → 事实 → 解释 → 企业问题 → 方法/产品 → 边界”检查主题跳跃、因果缺失、证据不支持、产品突然出现、关联不足、结论超证据、概念变化和论点重复。

问题类型：MISSING_BRIDGE、TOPIC_JUMP、EVIDENCE_MISMATCH、FORCED_INSERTION、CONTRADICTION、REPETITION、OVERCLAIM。

企业融合使用 L0–L4 和删除测试：L0 不植入，L1 品牌观点，L2 场景/案例映射，L3 产品桥接，L4 CTA。默认选择最低有效等级。

### 7.3 自动修复边界

莉莉丝可修复标点、连接词、句子拆分、重复排比、小标题格式、X 字符长度、小红书卡片分配和不改变事实的表达顺序。新事实、产品能力、证据、核心观点、企业定位和论证重排必须交给 004/巴啦啦。自动修订最多两轮，之后转人工审核。

## 8. 巴啦啦渠道规则

### 8.1 公众号

是深度解读，不是长文压缩。允许巴啦啦进行公开研究；新 Claim 必须重新证据校验。至少三个小标题，使用中文冒号，总字符不超过 13 个，且每个标题必须对应真实内容。输出标题候选、推荐标题、导语、正文、FAQ、证据说明、软 CTA 和视觉 Brief。

### 8.2 短视频

保留当前有效策略：3 秒 Hook、口语化、面对面分享、短句、情绪点、利他点、镜头、字幕、时长和来源。增加 AI 味儿与逻辑复核，不套公众号结构。

### 8.3 小红书

轻内容固定 `LIGHT_3_CARD`：发生了什么、核心判断、对读者/企业的意义。

深度内容使用 `DEEP_5_9_CARD`，可为 5、7 或 9 张，由信息量决定：封面、背景、事实、机制、争议/误区、企业场景、产品/品牌关联、边界、总结。每张卡保存标题、主文案、辅助文案、证据、信息结构、视觉 Brief 和版权限制；不得用模板凑数。

### 8.4 X/Twitter

默认英文发布、中文审阅，按语义拆分 Thread，每条通过本地兼容 X 官方规则的计数器且不超过 280 字符；重要 Claim 就近放来源，信息过多时增加条数，不删除关键事实。结构为核心判断、事件、原始观点、机制、企业影响、企业关联、边界、总结。

### 8.5 LinkedIn

英文主稿、中文备稿、内容支柱、企业场景、执行任务、证据、企业启示、视觉/轮播 Brief 和 Alt Text；中英文必须事实等价。

## 9. Skill 管理与路由

生产级 Skill 包括 enterprise-copy-auditor、enterprise-copy-orchestrator、enterprise-soft-insertion、huashu-wechat-creation、huashu-proofreading、huashu-research、huashu-info-search、huashu-script-polish、huashu-douyin-script、huashu-video-check、image-assistant、title-tag-cover-generator、geo-article-ai-friendly-transformation。

生产 Skill 只保留规则和提示词，不执行任意代码。每次保存 SkillTrace。导入流程为 Manifest 校验、平台/Secret/Prompt Injection 扫描、黄金样本回归、人工激活。

GitHub humanize、ClawHub 内容复用 Skill、小红书自动发布项目和任何要求模型 API/Cookie/平台登录的 Skill 仅为 reference-only，不能直接进入生产。

Skill 路由必须服从：安全/合规 > 企业正式口径 > 当前任务要求 > 已确认条件化偏好 > 普通风格偏好。Skill 不能覆盖用户当前明确要求。

## 10. 持久化实现

### 10.1 本地文件

JSON UTF-8；临时文件 → Schema 校验 → 原子改名 → READY；内容版本追加、审计追加、输入哈希、幂等键、失败保留历史、磁盘超阈值只提醒不清理。FeedRun 同一运行目录不得并发写入。

### 10.2 PostgreSQL

表：organizations、users、content_missions、agent_runs、content_assets、content_versions、content_validations、evidence_requests、review_requests、review_decisions、generated_assets、content_packages、content_templates、content_batches、source_attachments、skill_packages、skill_versions、audit_events、outbox_messages、inbound_messages、legacy_import_records。

所有查询带 organizationId；ContentVersion 触发器拒绝 UPDATE/DELETE；版本号按资产递增；审计追加写；Outbox 与业务事务同写；Inbox 按 messageId、idempotencyKey、organizationId 去重。

### 10.3 Redis/BullMQ

负责生成队列、批量任务、延迟重试、并发控制、租约、取消和积压指标。模型失败指数退避，达到次数进入 DEAD。

### 10.4 S3/MinIO

保存图片、附件、研究附件和导出包。每项保存 checksum、MIME、byteSize、rights、scanStatus 和 metadataCleaned。

## 11. API 与本地 CLI

生产 API 覆盖 `/health`、`/ready`、missions、runs、batches、content-assets、versions、variants、localizations、assets、validate、reviews、review-decisions、content-packages、export、deliver、evidence-requests、agent-protocol、source-attachments、templates 和 skills。

本地 CLI：`build_daily_radar.py`、`mark_radar_delivered.py`、`build_variant_brief.py`、`generate_variant_package.py`、`validate_variant.py`、`review_content.py`、`render_variant_markdown.py`、`render_review_book.py`、`capture_human_feedback.py`。

## 12. 协作协议

协议消息：EVIDENCE_REQUEST、EVIDENCE_FULFILLMENT、REVIEW_REQUEST、REVIEW_DECISION、CONTENT_PACKAGE、HANDOFF_RECEIPT。Envelope 包含 messageId、messageType、sender、recipient、organizationId、traceId、idempotencyKey、sentAt、payload。

HMAC-SHA256、恒定时间比较、5 分钟时间窗、Inbox 去重、Outbox 最多 12 次重试后 DEAD，交付最多 3 次短重试。AGT-003 提供 Evidence，AGT-006 审核，AGT-005 只接收 ContentPackage，不回传发布或效果。

## 13. 安全、网络与隐私

允许宿主模型/图片、AGT-003/005/006、PostgreSQL、Redis、S3 和公开只读研究。禁止发布接口、登录授权、状态轮询、监测接口、localhost/私网管理接口、file/data/javascript URL、未知附件执行。

外部查询禁止携带客户名称、内部交易、未公开产品/路线图、内部人员、内部竞争策略和受限原文。网页指令按不可信文本处理。附件需校验 MIME、checksum、byteSize、病毒和 Prompt Injection；PII/Secret 进入 fail-closed 校验。

## 14. 迁移

AI-Content-Factory 只迁移任务、草稿、内容、图片、模板、编辑历史和可恢复版本；不迁移平台账号、凭据、发布记录、链接、监测和效果指标。

迁移：扫描 → 字段分类 → 平台字段剥离 → hash → 版本映射 → 版权状态 → dry-run → 数量/hash 对账 → 正式导入 → `legacyImported`。无法还原的历史版本不得伪造 Lineage。

## 15. 观测、恢复与运维

记录 traceId、runId、stepId、requestId、幂等键、宿主/模型/Prompt 版本、Token、耗时和错误类型。指标包括成功率、模型失败、Evidence/Review 等待、队列积压、重试、死信、宿主耗时、Token、变体审核、P0/P1、磁盘和 hash 错误。

生产必须完成 SSO/OIDC、PostgreSQL PITR、Redis HA、对象存储版本和备份、恢复演练、死信重放、人工接管、OpenTelemetry 告警和 Runbook。

## 16. 实施阶段

1. V4 文档和契约统一：主文档、分册、领域对象、状态机、双存储接口。
2. 本地持久化闭环：LocalFileRepository、READY、不可变版本、审计、雷达和 Markdown。
3. 莉莉丝/巴啦啦：AI 味儿、逻辑、ReviewReport、自动修复、公众号研究、渠道变体、SkillTrace。
4. 反馈进化：RawFeedback、候选规则、适用/排除条件、冲突处理、人工确认。
5. 生产基础设施：HostRuntime、PostgreSQL、Redis、S3、OPA、SSO、HMAC、OpenTelemetry、备份。
6. 生产验收：单组织 UAT、三篇样本回放、迁移 dry-run、协议联调、安全测试、恢复演练和 ContentPackage 交付。

## 17. 验收标准

- 本地模式不依赖前端、数据库、Redis、Docker 或额外模型 API；
- 生产模式支持 PostgreSQL、Redis、S3 和宿主桥接；
- 模型失败不产生伪完成；
- ContentVersion 不可变，修改有父版本和原因；
- 未验证 Claim、未清权资产和 P0 问题不能 APPROVED/打包；
- 公众号至少 3 个 13 字以内小标题；
- 小红书轻内容固定 3 张，深度内容 5–9 张；
- X 每条通过字符计数；
- 巴啦啦不能绕过莉莉丝，莉莉丝不能自我批准；
- 反馈按条件适用，不全局套用；
- 第三方 Skill 不直接进入生产；
- ContentPackage 无平台字段；
- 交付后不发布、不监测、不生成 LearningProposal；
- traceId 可重建全过程；
- 跨组织泄漏、P0 回归和宿主不可用时的伪完成均为 0。

## 18. 文件分册

```text
docs/
  IMPLEMENTATION_PLAN_V4.0.md
  DOMAIN_MODEL_V4.0.md
  STORAGE_ENGINE_V4.0.md
  AGENT_PROTOCOL_V4.0.md
  CHANNEL_POLICY_V4.0.md
  REVIEW_AND_BALALA_V4.0.md
  SECURITY_AND_OPERATIONS_V4.0.md
```

分册只能展开主文档，不得隐藏未在主文档声明的规则。V1–V3 保留为历史归档。
