# AGT-RSN-004 Content Agent

## V5.3 authoritative design

The V5.3 documents are the single implementation source of truth. They cover
the complete content-asset persistence engine, local dialogue mode, optional
production services, internal multi-agent scheduling, Lilith review gates,
Xiaodiandian GEO/SEO proposals, Balala channel variants, feedback applicability,
immutable versions, evidence lineage, security boundaries, and handoff without
publishing or platform-monitoring fields.

- [V5.3 implementation plan](docs/IMPLEMENTATION_PLAN_V5.3.md)
- [V5.3 domain model](docs/DOMAIN_MODEL_V5.3.md)
- [V5.3 runtime and scheduler](docs/RUNTIME_AND_SCHEDULER_V5.3.md)
- [V5.3 storage engine](docs/STORAGE_ENGINE_V5.3.md)
- [V5.3 agent collaboration](docs/AGENT_COLLABORATION_V5.3.md)
- [V5.3 GEO/SEO Xiaodiandian](docs/GEO_SEO_XIAODIANDIAN_V5.3.md)
- [V5.3 Lilith review](docs/REVIEW_LILITH_V5.3.md)
- [V5.3 Balala variants](docs/VARIANT_BALALA_V5.3.md)
- [V5.3 security and operations](docs/SECURITY_OPERATIONS_V5.3.md)
- [V5.3 migration](docs/MIGRATION_V5.3.md)

The local dialogue profile remains file-only and host-model driven: Codex uses
the Codex host, JovaAI uses the JovaAI host, and no additional model API is
configured by AGT-RSN-004.

AGT-RSN-004 是 RISEN 家族的纯内容域智能体。它把 Strategy、Audience、
Message、Claim、Evidence、BrandRule、Policy 和 ContentPlan 转换为可审核、
可复用、可交付的内容资产。

内容包交付是生命周期终点。本服务不连接内容平台，不保存平台凭据，不发布内容，
不查询发布状态，也不采集或评价发布效果。

## 已实现

- TypeScript Monorepo：Next.js 工作台、Fastify API、BullMQ Worker；
- PostgreSQL、不可变 `ContentVersion`、组织隔离和审计字段；
- Context、Research、Matching、Writing、Post-write、Quality 六阶段流水线；
- Brief、Research、Outline、长短内容、渠道变体、本地化、视觉简报、
  MediaPitch、AnswerBlock、PublicStatement 和 ContentReusePlan；
- Claim-Evidence 强绑定、EvidenceRequest 和 fail-closed 内容校验；
- 品牌、政策、披露、证据时效、使用权和高风险人工审核门；
- HMAC 签名的 AGT-003/005/006 协作协议、事务 Outbox、幂等 Inbox、
  指数退避、死信和签名交付回执；
- 微信、小红书、X/Twitter、视频的内容格式适配，不含平台 API 字段；
- 内容工作台、资产库、模板、批量任务、不可变版本、派生资产 Lineage、
  审核、打包与 DOCX/HTML/Markdown/JSON 导出；
- 安全附件上传契约、病毒扫描/文本提取门、PII/Secret/Prompt Injection 防护；
- 图片实际格式校验、解码限额、元数据清理、版权状态与到期门；
- Skill 导入、Manifest 摘要、安全检查、隔离回归和人工激活；
- OpenTelemetry Trace/Metric、健康/就绪探针、限流、安全响应头与运行租约恢复；
- AI-Content-Factory 内容数据迁移工具；
- 平台域名、发布、监测、账号和效果字段的源码边界检查。

能力、Skill 和投产差距详见：

- [能力与 Skill 清单](docs/CAPABILITY_CATALOG.md)
- [宿主模型接入契约](docs/HOST_RUNTIME_INTEGRATION.md)
- [智能体协作协议](docs/AGENT_PROTOCOL.md)
- [投产闭环清单](docs/PRODUCTION_READINESS.md)
- [GitHub 复用评估](docs/GITHUB_REUSE_ASSESSMENT.md)
- [非 GitHub 能力实施计划](docs/IMPLEMENTATION_PLAN_NON_GITHUB.md)

## 模型原则

AGT-RSN-004 不配置任何第三方模型供应商 API，也不保存模型 API Key。

- 部署在 Codex：由 Codex 宿主桥接并选择 Codex 当前模型；
- 部署在 JovaAI：由 JovaAI 宿主桥接并选择 JovaAI 当前模型；
- 文本和图片都通过统一 `HostRuntimeExecutor` 注入；
- 宿主没有提供相应能力时，任务明确失败，不返回 Mock 或 Prototype 内容。

```dotenv
HOST_RUNTIME_ID=codex
HOST_RUNTIME_MODULE=./deployment/codex-host-runtime.mjs
```

`HOST_RUNTIME_MODULE` 必须导出 `createHostRuntime()`。接口见
[`packages/adapters/src/host-runtime.ts`](packages/adapters/src/host-runtime.ts)。
生产环境没有宿主桥接时拒绝启动 Worker。

注意：Codex 对话模型不会自动成为本地 Node.js 服务的可调用函数。Codex 部署层
必须提供桥接；当前对话可用于协助开发和人工测试，但不能替代无人值守运行时。

## 本地启动

要求 Node.js 22+、pnpm 10+ 和 Docker。

```powershell
Copy-Item .env.example .env
docker compose up -d
pnpm install
pnpm --filter @risen/content-database migrate
pnpm dev
```

默认地址：

- Web：`http://localhost:3000`
- API：`http://localhost:4004`
- MinIO Console：`http://localhost:9001`

开发环境未启用 `REPOSITORY_DRIVER=postgres` 时使用内存 Repository。生产环境强制
使用 PostgreSQL、签名身份、正式 OPA、签名智能体协议和宿主模型桥接。

`GET /health` 仅表示进程存活；`GET /ready` 会验证数据库、队列和宿主运行时，
应作为生产流量探针。

## 内容工作流

```text
Mission
  → Context
  → Evidence pre-check
  → Host model content generation
  → Immutable Version
  → Claim / Evidence / Brand / Policy / Rights validation
  → ReviewRequest
  → ReviewDecision
  → ContentPackage
  → Handoff
```

当事实 Claim 缺少已验证且权利清晰的 Evidence 时，流程停在
`EVIDENCE_REQUIRED` 并向 AGT-RSN-003 生成 `EvidenceRequest`。此时不调用写作模型。

`DELIVERED` 只表示内容包已经交付下游，不代表已经发布。AGT-RSN-004 不接收发布
结果或效果数据回调。

## 验证

```powershell
pnpm typecheck
pnpm test
pnpm lint:boundaries
pnpm build
```
