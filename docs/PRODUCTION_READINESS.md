# 投产闭环清单

以下事项不扩张 AGT-RSN-004 的纯内容边界，但决定它能否真实投入使用。

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

本地已完成静态检查、31 个自动化测试、平台边界检查、依赖安全审计和生产构建。当前机器没有
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
