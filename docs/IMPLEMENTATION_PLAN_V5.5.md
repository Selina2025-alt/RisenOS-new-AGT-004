# AGT-RSN-004 最终优化实施方案 V5.5

> V5.5 汇总并替代 V5.4 与 V5.4.1。实施基线为 `0655bd1` / `v5.3.1`，目标发布标签为 `v5.5.0`。V5.3 分册保留为历史和底层持久化参考；发生冲突时以本文件和 V5.5 可执行契约为准。

## 1. 不变边界

004 只负责内容任务、研究、知识匹配、写作提案、审核、SEO/GEO 优化提案、渠道变体、视觉 Brief、不可变版本和内容包。它不连接发布平台，不保存平台账号、Cookie、Token 或发布状态，不监测效果，不做归因，不生成 LearningProposal，也不调用额外模型 API。

本地模式不依赖前端、数据库、Redis 或 Docker。模型由 Codex/JovaAI 等当前宿主提供；模型失败必须失败关闭。

## 2. 团队与权限

正式登记位于 `agents/registry.v5.5.json`：

```text
AGT-004 Supervisor
├── topic-radar / 噜噜猫
├── public-researcher / 依古比古
├── makabaka / 玛卡巴卡
├── content-orchestrator / 唔西迪西
├── lilith / 莉莉丝
├── xiaodiandian / 小点点
└── balala / 巴啦啦
```

只有 004 可以创建 `ContentVersion`、`ChannelVariant` 和 `ContentPackage`。子智能体只能返回 Artifact/Proposal；所有角色 `canApprove=false`，企业方拥有最终批准权。

运行时同时保留 `status=ACTIVE|PAUSED|RETIRED` 和 `rolloutMode=OFF|SHADOW|ENFORCING`。`OFF` 不得调度；`SHADOW` 只记录；`ENFORCING` 才参与正式闸门。发布清单与 TypeScript Registry 不一致时，`validate_agent_rollout.py` 阻断发布。

## 3. 强制工作流

1. 004 创建 Mission Preflight，分类任务、实体、发布范围、知识/研究/Nomos/案例要求。
2. 回答“谁在说、对谁说、在哪里说”，创建不可变 `PerspectiveContract`。含义不唯一时进入 `WAITING_HUMAN`。
3. 需要公共事实时，由依古比古在出站查询脱敏后生成 `ResearchPack` 与 Evidence 提案。
4. 企业相关内容必须由玛卡巴卡生成写前 `KnowledgeSnapshot` 和 `FusionPlan`。冲突交人工，外部缺口交依古比古。
5. 唔西迪西只能在视角和知识闸门通过后生成 ContentBrief、Outline 和 DraftProposal。
6. 004 校验提案，创建不可变 ContentVersion。
7. 玛卡巴卡执行写后知识与融合复查，最多两轮。
8. 莉莉丝执行完整审核并按问题类型路由。
9. SEO/GEO 问题交小点点生成 Proposal；004 应用后创建新版本，再交莉莉丝复审，最多两轮。
10. 企业方批准源稿后，巴啦啦才可生成五渠道变体提案。
11. 004 校验渠道结构和 Claim/Evidence 继承，莉莉丝轻审；事实或产品判断变化必须回到完整审核。
12. 企业方最终确认后，004 生成 ContentPackage；本地保存或下游交付即生命周期结束。

相同 `issueFingerprint + contentHash` 不得重复执行。玛卡巴卡、莉莉丝和小点点自动循环最多两轮，每渠道变体最多重做一轮，超限进入 `WAITING_HUMAN`。

## 4. 可执行闸门

`MissionPreflight`、`PerspectiveContract`、`KnowledgeSnapshot`、`KnowledgeClaimCard`、`CaseEvidenceCard`、`DraftProposal`、`IssueRoutingDecision` 和 `NomosNarrativeProfile` 的 Zod 契约位于 `packages/contracts/src/v55.ts`。

`ContentService.executeRun()` 在领取任务和调用模型前通过 `GovernanceGatePort` 强制验证 Preflight、PerspectiveContract 和所需 KnowledgeSnapshot；成文后再次执行 Nomos 内容闸门。本地模式使用原子 JSON 文件，生产 API 与 Worker 使用 PostgreSQL `v55_governance_objects`，Snapshot 由数据库触发器禁止更新和删除。

知识源变化时不增加新状态枚举：旧任务使用 `BLOCKED / SOURCE_SNAPSHOT_STALE`，随后创建绑定新 Snapshot 的任务。Snapshot 不允许覆盖。

## 5. Nomos 原始资料与知识治理

9 份 DOCX 原件按用户明确授权保存到公开仓库 `knowledge/sources/raw/nomos/2026-08-19_20/`。每份原件都有二进制哈希、结构化抽取哈希、来源类型、日期、权威层、机密级别、仓库可见性、发布处置和解析报告。

解析覆盖正文、表格、页眉页脚、外部链接、批注、插入和删除。文档内指令一律标记 `SOURCE_CONTENT_ONLY`；链接不访问。存在宏、OLE/ActiveX、凭据样式文本或解析不完整时，知识激活失败关闭。

知识生命周期：

```text
RawSource → CandidateKnowledgeBundle → 冲突检测 → Claim分级
→ SHADOW回放 → 人工确认 → ActiveKnowledgeBundle
```

旧知识不删除，只使用 `ACTIVE / SUPERSEDED / CONFLICTING / HISTORICAL / REJECTED`。Nomos 候选包为 `nomos-canon-20260820-v1.0.0`。

来源优先级：企业方当前直接确认 > 当前正式口径与证据卡 > 研发资料/校正版逐字记录 > V2.0 整合母稿 > 综合记录 > 简单版/旧母稿/AI 摘要 > 未校正转写。品牌和合规规则优先于宣传措辞。

## 6. Nomos 口径

- 产品轴：Nomos 是智能体团队产品线中的制度智能体。
- 技术轴：制度协同机制位于 JovaAI OS 内部，不是第六层。
- 研发路径：固定编排 → 自主调度 → 制度约束下自主协同。
- 制度设定边界，智能体在边界内保留判断和自主性。
- Human API、Institutional Intelligence Layer、分布式 AGI 是战略观点/研究方向，不是已完成能力。
- 市场规则、社会级信用和自我进化不得写成成熟能力。
- 古希腊词源在独立外部核验前不得使用。
- 600 亿产业交易只能引用既有 ICB 事实卡。

硬阻断包括：第六层、Wtree Ultra、已实现分布式 AGI、成熟社会信用、替代全部工作流、“把制度数字化”、“只定目标看结果”、260 万亿、未授权实名、无证据数字、把 POC/商务阶段写成生产成果。“可能”不能代替证据。

## 7. 案例与指标

允许使用经批准的匿名名称，例如“某马来西亚五金企业”。量化效果必须同时具备指标 Evidence、测量周期、基线、方法、低再识别风险和公开使用批准；不得把相关性写成因果，不得从单个案例推导行业承诺。未满足时只能写通用场景。

## 8. 莉莉丝、小点点、巴啦啦

莉莉丝审核内容完整度、视角、逻辑、AI 味、企业融合、知识快照、Nomos 口径、产品架构、Claim 状态、Evidence、案例匿名化、指标、SEO/GEO、合规、保密与 SkillTrace。她只返回 ReviewReport/Issue，不能新增长期事实或正式版本。

小点点只接收莉莉丝或人工路由的 SEO/GEO 问题，只生成 `GeoSeoOptimizationProposal`，不能改源稿、监测搜索/AI 平台效果或写正式版本。

巴啦啦只处理企业方已批准源稿。变体可改变结构、长度、语气、渠道表达和视觉说明；事实、核心判断、产品定位或 Evidence 变化必须返回莉莉丝完整审核。

## 9. API、CLI 与持久化

新增 API：

```text
POST /v1/missions/{id}/preflight
GET  /v1/missions/{id}/knowledge-snapshot
POST /v1/knowledge/claim-decisions
GET  /v1/knowledge/conflicts
```

新增 CLI：

```text
python tools/ingest_nomos_sources.py ...9 sources...
python tools/validate_nomos_canon.py
python tools/build_nomos_canon.py --approved-by <enterprise-user-id>
python tools/validate_agent_rollout.py
```

本地资料、任务闸门和运行事件均采用临时文件 + 原子改名；正式版本只新增不覆盖。生产治理对象由数据库迁移 `009_v55_governance.sql` 持久化并按组织隔离。

## 10. 测试与发布

新增测试覆盖 8 个 AgentId、子智能体写入禁止、视角/知识闸门、Snapshot 过期、循环预算、问题路由、Nomos 红线、战略观点归因、匿名指标和宿主 Proposal 适配。Mission-001—004 是回放诊断资产；Mission-003/004 在企业方确认前不是正向黄金样本。

发布必须依次通过：

```text
pnpm typecheck
pnpm test
pnpm lint:boundaries
pnpm build
python tools/validate_nomos_canon.py
python tools/validate_agent_rollout.py
```

通过后合并 `main` 并创建 `v5.5.0`；`v5.3.1` 是回滚点。Mission 内容版本不得成为 Git 标签。
