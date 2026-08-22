# AGT-RSN-004 V5.5.1 仓库导航

本文说明各目录存放什么、谁可以写、哪些文件是权威入口。

## 根目录入口

| 文件 | 作用 |
|---|---|
| `README.md` | 项目总入口，适合第一次阅读 |
| `active_context.json` | 当前启用知识、策略、模型和运行模式指针 |
| `package.json` | Monorepo 命令和项目版本 |
| `.env.example` | 生产服务配置示例，不得填写真实密钥后提交 |
| `.gitattributes` | 保证文本 Artifact 跨平台保持 LF，避免哈希失效 |

## `agents/`

- `registry.v5.5.json`：Agent ID、输出 Schema、写入权和 rolloutMode 的权威登记；
- `README.md`：角色和 rolloutMode 规则。

运行中的智能体不能修改 Registry，也不能自行切换到 `ENFORCING`。

## `packages/`

```text
packages/contracts/  Zod Schema、任务和协作协议
packages/core/       Supervisor、Runtime、Coordinator、Handler、持久化核心
packages/adapters/   HostRuntime、策略、协议和下游适配器
packages/database/   PostgreSQL Store 与迁移
```

重点文件：

- `packages/core/src/team-runtime.ts`：统一 Bootstrap；
- `packages/core/src/team-coordinator.ts`：规则型团队协调器；
- `packages/core/src/v55-handlers.ts`：7 个子智能体 Handler；
- `packages/core/src/local-agent-store.ts`：本地文件持久化；
- `packages/contracts/src/v55.ts`：V5.5 契约；
- `packages/database/migrations/010_agent_team_runtime.sql`：生产团队任务表。

## `knowledge/`

### 当前入口

- `knowledge/00_知识库索引.md`；
- `active_context.json` 中的 `active*` 指针；
- `knowledge/canon/*/ACTIVE_MANIFEST.json`。

### 资料生命周期

```text
sources/raw
→ sources/ingested
→ CandidateKnowledgeBundle
→ 冲突检测
→ 人工确认
→ canon/ActiveKnowledgeBundle
```

目录说明：

```text
knowledge/brand/        企业品牌和叙事
knowledge/products/     产品、架构和智能体正式口径
knowledge/agents/       官网公开智能体名单
knowledge/clients/      客户、场景和商业模式
knowledge/evidence/     产品事实、ICB数据和证据闸门
knowledge/compliance/   禁用表达与合规
knowledge/security/     保密和内容分级
knowledge/channels/     渠道内容规则
knowledge/competitive/  竞品与参考内容
knowledge/policy/       政策引用规范
knowledge/visual/       视觉规范与资料缺口
knowledge/sources/      原始来源、解析结果和冲突登记
knowledge/canon/        当前激活知识包
```

`sources/raw` 只是原始证据存档，不能直接作为对外口径。

## `missions/`

每个 Mission 应形成完整目录，而不是覆盖同一个文件：

```text
missions/<MISSION-ID>/
  mission / preflight / perspective
  research/
  knowledge/
  briefs/
  drafts/
  review/
  geo-seo/
  variants/
  audit/
```

`ContentVersion`、TopicSnapshot、HumanGateDecision 和正式 Artifact 都是不可变对象。修改时新增版本，不覆盖父版本。

## `intelligence/`

- `inbox/`：资讯任务本地副本；
- `normalized/`：统一 Schema 后的 Signal；
- `topic-radar/`：候选选题与日报；
- `research/`：批准后或指定主题的深度研究；
- `config/`：来源、评分和公开查询策略。

雷达候选阶段不进行大规模外网深研，不用模板补足数量。

## `review/`、`drafts/` 和 `variants/`

- `drafts/`：独立测试稿或正式 ContentVersion 派生文件；
- `review/`：莉莉丝报告、小点点 Proposal 和 CoverageMap；
- `variants/`：只有已批准源稿才能生成的平台变体。

变体不包含平台账号、发布时间、发布状态或效果数据。

## `tools/` 和 `scripts/`

Python 工具主要处理本地知识、DOCX、雷达和确定性渲染；TypeScript 脚本主要处理 Runtime、回放和迁移。

所有写文件工具应遵守：

```text
临时文件
→ Schema校验
→ 哈希
→ 原子改名
→ READY或审计事件
```

## `docs/`

当前权威层次：

```text
README.md
→ IMPLEMENTATION_PLAN_V5.5.md
→ IMPLEMENTATION_PLAN_V5.5.1.md
→ PRODUCTION_READINESS.md
```

V5.3 文档是底层持久化历史设计。发生冲突时，以 V5.5 和 V5.5.1 为准。

## 哪些内容不能从仓库判断

仓库代码和资料不能证明：

- 当前部署已经配置 HostRuntime；
- 7 个子智能体已经通过企业生产验收；
- 某个平台已经发布内容；
- 某篇内容取得了曝光或转化；
- 原始内部资料允许公开引用；
- 研发方向已经成为生产能力。

这些结论必须分别查看运行时健康状态、rolloutMode、HumanGateDecision、知识 Claim 状态和部署验收记录。
