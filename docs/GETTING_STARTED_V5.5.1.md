# AGT-RSN-004 V5.5.1 上手指南

本文面向三类使用者：内容使用者、代码维护者和部署工程师。

## 1. 内容使用者：在 Codex 或 JovaAI 中使用

### 第一步：打开正确的工作区

将仓库根目录作为当前工作区。宿主应先读取：

```text
README.md
active_context.json
knowledge/00_知识库索引.md
agents/registry.v5.5.json
```

### 第二步：给出任务和视角

完整任务至少说明：

- 要写什么；
- 谁在说；
- 对谁说；
- 在哪里说；
- 是否需要公开研究；
- 希望停在哪个闸门。

示例：

```text
以艾氪智能官方视角，面向传统企业负责人，围绕“AI为什么演示好但落地难”写一篇微信公众号深度文章。
需要先做公开研究和企业知识匹配；写完交莉莉丝审核，停在源稿人工审核，不生成渠道变体。
```

### 第三步：检查持久化产物

一个合格任务不应只有聊天回复，还应在 `missions/<MISSION-ID>/` 保存：

```text
MissionPreflight
PerspectiveContract 或人工确认依据
ResearchPack
KnowledgeSnapshot
ContentBrief / Outline
DraftProposal 或 ContentVersion
ClaimBinding
ReviewReport
SkillTrace
human-review-copy.md
```

如果任务涉及 GEO/SEO，还应看到 `GeoSeoOptimizationProposal` 和 `ContentCoverageMap`。

### 第四步：人工批准

源稿通过莉莉丝审核后，企业方必须针对具体文件哈希批准。批准后才能生成巴啦啦五渠道变体。

建议回复格式：

```text
SOURCE_DRAFT_APPROVED
artifact: <artifact-id>
hash: <sha256>
意见：通过，进入渠道变体。
```

普通聊天中的“可以”“继续”只能作为人工意图证据；脱离对话的正式运行时还需要生成不可变 `HumanGateDecision`。

## 2. 代码维护者：最小验证

### 环境

```text
Node.js 22
pnpm 10.15.1
Python 3
```

### 安装

```powershell
corepack enable
pnpm install --frozen-lockfile
```

### 验证

```powershell
pnpm team:validate
pnpm test
pnpm typecheck
pnpm lint:boundaries
pnpm build
python tools/validate_nomos_canon.py
```

当前基线是 72 项自动化测试通过，其中 Core 53 项。

### 健康状态

```powershell
pnpm team:health
```

未配置宿主桥接时，`DEGRADED` 是安全的 fail-closed 状态：

- Registry 可读；
- 7 个 Handler 已注册；
- 本地存储可读写；
- 历史任务可查询；
- 模型生成任务不可执行；
- 不会降级到额外模型 API 或 Mock。

## 3. 独立 CLI 运行

CLI 模型任务要求：

```powershell
$env:AGT004_REPOSITORY_ROOT = (Get-Location).Path
$env:HOST_RUNTIME_MODULE = "D:\absolute\path\host-runtime-bridge.mjs"
```

宿主模块必须导出 `createHostRuntime()`，详见 `docs/HOST_RUNTIME_INTEGRATION.md`。

### 创建团队任务

```powershell
pnpm team:run -- <missionId> <organizationId> <traceId> <createdBy> <sourceArtifactId1,sourceArtifactId2> <wechat,short_video,xiaohongshu,x,linkedin>
```

注意：`sourceArtifactIds` 必须已经存在于团队 Artifact Store。`team:run` 不是一个直接接收自然语言 Prompt 的入口。

### 查询、暂停、恢复和取消

```powershell
pnpm team:show -- <runId> <organizationId>
pnpm team:pause -- <runId> <organizationId>
pnpm team:resume -- <runId> <organizationId>
pnpm team:cancel -- <runId> <organizationId>
```

### 提交人工决定

```powershell
pnpm team:decide -- <runId> <organizationId> <artifactId> <artifactHash> <gate> <APPROVED|REJECTED> <userId> <idempotencyKey>
```

可用 `gate`：

```text
PERSPECTIVE_CONFIRMED
SOURCE_DRAFT_APPROVED
FINAL_VARIANTS_APPROVED
KNOWLEDGE_CONFLICT_DECIDED
```

## 4. 部署工程师：生产模式

生产模式需要：

- HostRuntime；
- PostgreSQL；
- Redis/BullMQ；
- S3/MinIO；
- 企业 SSO/OIDC；
- OPA 或等价策略执行器；
- OpenTelemetry；
- AGT-003、AGT-006 和 AGT-005 的真实协作端点。

数据库迁移至少包括：

```text
009_v55_governance.sql
010_agent_team_runtime.sql
```

API 只创建任务和人工决定；Worker 负责消费数据库中的 `READY` 任务。生产环境不能让 API 进程直接执行子智能体。

完整上线阻断项见 `docs/PRODUCTION_READINESS.md`。

## 5. 常见问题

### 为什么显示 DEGRADED？

最常见原因是没有 `HOST_RUNTIME_MODULE`。这不代表 Handler 缺失；检查 `missingHandlers` 是否为空。

### 为什么 7 个子智能体都是 SHADOW？

这是上线安全策略。每个角色完成回放、Schema、权限、失败行为和企业方验收后，才能通过人工提交切换为 `ENFORCING`。

### 为什么不能直接生成渠道变体？

巴啦啦必须消费已经获得 `SOURCE_DRAFT_APPROVED` 的源稿。SHADOW Artifact 或普通聊天确认不能绕过正式闸门。

### 为什么知识库里同时存在原始文档和不同版本口径？

原始来源用于追溯，`ingested` 用于结构化解析，`canon` 才表示当前激活口径。旧口径不删除，以便审计和回滚。

### 可以用自己的 OpenAI、Claude 或其他模型 API Key 吗？

不可以直接配置给 004。模型只能由部署位置的 HostRuntime 提供，密钥归宿主管理。

### 004 会发布内容吗？

不会。`ContentPackage` 交付后，004 生命周期结束。
