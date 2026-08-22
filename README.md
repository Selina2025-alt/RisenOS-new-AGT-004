# AGT-RSN-004 独立内容工作区

AGT-RSN-004 是 RISEN 家族的纯内容域智能体。它把 Strategy、Audience、Message、Claim、Evidence、BrandRule、Policy 和 ContentPlan 转换为可审核、可复用、可交付的内容资产。

内容包交付是生命周期终点。本项目不连接微信、小红书、X/Twitter、抖音、TikTok 或 LinkedIn 发布接口，不保存平台凭据，不发布内容，不查询发布状态，不采集发布效果，也不生成 LearningProposal。

## V5.5 / V5.5.1 权威设计

V5.5 定义内容和知识治理，V5.5.1 是统一运行接线修订。7 个子智能体已统一注册 Handler，但初始均处于 `SHADOW`；企业验收后才逐个切换 `ENFORCING`。

- [V5.5 最终实施方案](docs/IMPLEMENTATION_PLAN_V5.5.md)
- [V5.5.1 统一运行接线实施记录](docs/IMPLEMENTATION_PLAN_V5.5.1.md)
- [V5.5 团队登记](agents/README.md)
- [Nomos 正式内容口径](knowledge/products/Nomos制度智能体_正式内容口径_V2.0.md)

V5.3 文档保留为历史设计基线，不再作为新增实现的权威入口。

- [V5.3 总实施方案](docs/IMPLEMENTATION_PLAN_V5.3.md)
- [领域模型](docs/DOMAIN_MODEL_V5.3.md)
- [运行时与调度器](docs/RUNTIME_AND_SCHEDULER_V5.3.md)
- [存储引擎](docs/STORAGE_ENGINE_V5.3.md)
- [多智能体协作](docs/AGENT_COLLABORATION_V5.3.md)
- [小点点 GEO/SEO](docs/GEO_SEO_XIAODIANDIAN_V5.3.md)
- [莉莉丝审核](docs/REVIEW_LILITH_V5.3.md)
- [巴啦啦变体](docs/VARIANT_BALALA_V5.3.md)
- [安全与运维](docs/SECURITY_OPERATIONS_V5.3.md)
- [迁移方案](docs/MIGRATION_V5.3.md)

## 本地对话模式

本地模式不依赖前端、数据库、Redis、Docker 或额外模型 API。数据可保存到本地工作区，当前对话和 CLI 负责调度，模型由部署宿主提供：Codex 使用 Codex 宿主模型，JovaAI 使用 JovaAI 宿主模型。

已有企业知识库、情报雷达和本地资料仍保留在：

```text
knowledge/
intelligence/
missions/
drafts/
review/
approved/
exports/
assets/
audit/
```

热点雷达只读取 AI HOT、AgentReach、Follow Builders 等任务写入的本地副本，负责去重、聚类、评分和选题建议，不连接资讯平台运营接口。

## 多智能体职责

```text
AGT-004 Supervisor
  ├── Lulumao：本地资讯选题雷达
  ├── Yigubigu：公开只读研究与 Evidence 提案
  ├── Makabaka：写前知识快照与写后口径复查
  ├── Wuxidixi：ContentBrief、Outline 与 DraftProposal
  ├── Lilith：审核、AI 味儿、逻辑、品牌、证据和合规
  ├── Xiaodiandian：GEO/SEO 优化提案，不直接写正式版本
  └── Balala：公众号、短视频、小红书、X、LinkedIn 渠道变体
```

子智能体不能自我批准、不能直接修改正式 ContentVersion、不能发布、不能监测平台效果。所有事实 Claim 必须可追溯到 Evidence，所有内容版本不可变。

## 宿主模型原则

AGT-RSN-004 不配置第三方模型 API，也不保存模型 API Key。统一通过 HostRuntime 注入文本和图片能力；宿主不可用时任务明确失败，不使用 Mock 或 Prototype Fallback。

## 运行与验证

生产服务模式支持 Next.js、Fastify、PostgreSQL、Redis/BullMQ、S3/MinIO 和 HostRuntime。V5.5 的 Preflight、Perspective、Snapshot、Claim 卡与冲突表由 `009_v55_governance.sql` 持久化到 PostgreSQL；本地模式继续使用原子文件存储。

```powershell
pnpm typecheck
pnpm test
pnpm lint:boundaries
pnpm build
python tools/validate_nomos_canon.py
python tools/validate_agent_rollout.py
pnpm team:health
```

当前核心实现包括：

- `packages/core/src/agent-runtime.ts`
- `packages/core/src/local-agent-store.ts`
- `packages/core/src/child-agents.ts`
- `packages/core/src/geo-seo.ts`
- `packages/contracts/src/collaboration.ts`
