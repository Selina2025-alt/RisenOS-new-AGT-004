# 投产闭环清单

以下事项不扩张 AGT-RSN-004 的纯内容边界，但决定它能否真实投入使用。

## V5.5 新增投产闸门

- [x] 运行 `009_v55_governance.sql`，持久化 Preflight、Perspective、Snapshot、Claim 卡与冲突表；
- [x] 生产 API 与 Worker 使用 PostgreSQL 治理存储，本地文件治理不进入生产；
- [x] `AGT004_REPOSITORY_ROOT` 指向随部署发布的版本化知识根目录；
- [x] 企业任务无 KnowledgeSnapshot 不得执行，Nomos Snapshot 的来源哈希必须仍在当前知识包；
- [x] 当前源版本未获 HUMAN 审核批准时，巴啦啦变体和 Localization 均被阻断；
- [x] 发布前执行 `validate_nomos_canon.py` 与 `validate_agent_rollout.py`。

## V5.5.2 审核与版本治理

- [x] 莉莉丝车轱辘话和叙事质量闸门；
- [x] Windows CRLF正文分段测试；
- [x] `VERSION`、根包、Registry和Agent版本一致性校验；
- [x] 项目、内容、知识包和Prompt/Skill版本分离；
- [x] 创建并推送 `v5.5.2` Git Tag，提交为`4c74698`；
- [ ] V5.6.0完成RC真实内容试跑、企业方验收、main覆盖和正式Tag。

## V5.6.0 闪闪内容包装

- [x] `packaging-copy-agent`进入契约、Registry、Runtime与健康检查；
- [x] 候选生成与自动选择使用两个隔离任务，莉莉丝执行第三个独立包装审核任务；
- [x] 微信、短视频、小红书、X、LinkedIn、YouTube、播客七渠道包装契约；
- [x] 176条标题短文本完成白名单字段清洗，CSV指令列不进入运行语料；
- [x] 人工反馈只生成未激活PreferenceCandidate，人工Override必须再经莉莉丝审核；
- [x] 本地CLI可原子落盘`PACKAGING-REVIEW-BOOK.md`；
- [x] 包装变化使旧联合批准清单失效，源版本变化产生`SUPERSEDED`标记；
- [x] 标题环节不增加独立人工闸门，保留源稿与最终变体总闸门；
- [ ] 用真实宿主模型完成E052—E056和当前10号文章SHADOW试跑；
- [ ] 企业方确认闪闪自动选择质量后，另行版本化决定是否提升ENFORCING。

## V5.5.1 统一团队运行时

- [x] API、Worker、CLI 使用同一 `createV55TeamRuntime()` Bootstrap；
- [x] 8/8 子智能体 Handler 已注册，Registry 与 Manifest 启动时校验；
- [x] 噜噜猫通过固定路径、最小环境变量、READY/Schema/哈希检查接入；
- [x] Task、Result、Artifact、Checkpoint、HumanGateDecision、Event 和 TeamRun 已支持本地持久化；
- [x] `010_agent_team_runtime.sql` 与 PostgreSQL Store 已实现；
- [x] TeamRun API、BullMQ Worker、暂停/恢复/取消和人工决定接口已接线；
- [x] SHADOW Artifact 不能满足正式源稿或变体闸门；
- [ ] 当前部署宿主提供真实 `HOST_RUNTIME_MODULE` 并通过健康检查；
- [ ] 8 个子智能体按顺序完成 SHADOW 回放和企业方验收后逐个切换 ENFORCING；
- [ ] 在真实 PostgreSQL/Redis 上完成租约恢复、重复消息和故障演练；
- [ ] 完成一个真实选题从研究到七渠道包装、VariantApprovalManifest 和 ContentPackage 的端到端验收。

## 已在代码中闭环

- [x] AGT-RSN-003/006 的签名 Envelope、事务 Outbox、指数重试、死信、幂等 Inbox；
- [x] Evidence 回填和 Claim 绑定、ReviewDecision 回填和逐段/Claim 评论；
- [x] AGT-RSN-005 ContentPackage 单向交付和签名 HandoffReceipt 校验；
- [x] 不可变版本、审批失效、派生变体/本地化/视觉资产 Lineage；
- [x] Schema、Claim-Evidence、基础 Brand/Policy/披露、Rights 与到期时间 fail-closed 门；
- [x] RBAC、organizationId 查询边界、签名身份和管理员审计 API；
- [x] 宿主调用超时、取消信号、幂等元数据、Run 租约恢复和队列失败重试；
- [x] Outbox 死信、过期 PROCESSING 回收和队列取消；
- [x] OpenTelemetry Trace/Metric、队列积压、宿主耗时/失败/Token 指标；
- [x] PII/Secret/Prompt Injection 防护、附件上传/扫描/提取契约；
- [x] 图片真实格式校验、解码限制、重编码去元数据；
- [x] 内容模板、批量任务、版本 Diff、逐段审核、四种格式导出；
- [x] prompt-only Skill Manifest 摘要、安全检查、隔离回归和人工启用；
- [x] AI-Content-Factory 内容侧迁移 dry-run 工具和平台运营字段剥离；
- [x] `/health`、`/ready`、API 限流、安全响应头和出站域名白名单。

## P0：部署方上线阻断项

- [ ] Codex 或 JovaAI 实现真实 `HostRuntimeExecutor`，包括 health、结构化生成、
  安全附件上传/扫描/提取；需要图片时再实现图片生成；
- [ ] AGT-RSN-003、006、005 部署实际端点并完成双向契约测试、密钥轮换和时钟同步；
- [ ] 企业提供正式 BrandRule、Policy、披露、高风险分类和版权规则语料；
- [ ] 网关接入企业 SSO，生成签名身份头；禁止公网客户端直接构造身份头；
- [ ] 生产 PostgreSQL/Redis/S3、TLS、备份恢复、生命周期、HA 和灾难恢复演练；
- [ ] 为十二类内容、四类渠道、目标语言、品牌和高风险场景建立黄金样本；
- [ ] 在 CI/发布门中把模型版本、Prompt、模板和 Skill 变化绑定到黄金回归；
- [ ] 用企业安全样本执行 Prompt Injection、恶意附件、跨组织和数据泄漏渗透测试；
- [ ] 对真实 AI-Content-Factory 副本执行 dry-run、数量/哈希对账和可恢复切换；
- [ ] 单组织 UAT：创作、证据补齐、修订、审核、打包、交付全链路。

## P1：投产后第一阶段

- [ ] 为宿主连续故障增加部署层熔断、流量降级和人工恢复开关；
- [ ] 为已开始执行的批量 Run 增加协作式取消；当前只安全取消尚未执行的 Run；
- [ ] 为编辑器增加自动保存和乐观并发冲突 UI；当前每次保存创建不可变新版本；
- [ ] 将 prompt-only Skill 升级为企业签名包和来源信任库；本服务不执行 Skill 代码，
  因而不存在依赖包执行面；
- [ ] 扩充 DOCX/HTML/Markdown/JSON 的视觉一致性黄金回归；
- [ ] 编写运营手册、告警分级、死信处置、故障降级和人工接管 Runbook；
- [ ] 生产验证后再决定是否启用 PostgreSQL RLS；当前隔离由应用查询、身份签名和
  冲突保护共同执行，数据库账号不得暴露给租户。

## 当前验证边界

本地已完成类型检查、88 个自动化测试（其中核心运行时 69 项）、平台边界检查和生产构建。当前机器没有
Docker，因此尚未在本机运行真实 PostgreSQL、Redis、S3、OPA 或多智能体端到端测试；
这些属于上面的部署验收项，不能用内存测试结果替代。

## 交付前质量指标

这些指标只评价内容交付质量，不是发布后效果：

- Schema 合规率 100%；
- 未验证事实 Claim 进入 APPROVED 的数量为 0；
- 未清权视觉资产进入 ContentPackage 的数量为 0；
- 跨租户数据泄漏为 0；
- 黄金样本阻断级回归为 0；
- 每个交付包都能用 `traceId` 重建上下文、模型执行、版本、校验和审核；
- 宿主不可用时不产生正式完成状态。
