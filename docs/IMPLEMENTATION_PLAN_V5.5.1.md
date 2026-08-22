# AGT-RSN-004 V5.5.1 统一运行接线与安全上线实施记录

> 本文是 V5.5 的运行接线修订。内容、知识和渠道规则继续以 V5.5 为准；涉及团队启动、任务调度、恢复、人工闸门和生产队列时，以本文件为准。目标候选标签为 `v5.5.0-rc.1`，企业验收前不得创建正式 `v5.5.0`。

## 1. 实施结论

V5.5.1 已建立单一 `createV55TeamRuntime()` Bootstrap。API、Worker、本地 CLI 使用同一 Agent Registry、七个 Handler、任务契约与协调器，不再各自维护 Agent 定义。

初始发布状态固定为：

```text
agt-004 = ENFORCING
topic-radar / public-researcher / makabaka / content-orchestrator
/ lilith / xiaodiandian / balala = SHADOW
```

`SHADOW` 产物带生成时的 rolloutMode，只能用于回放和人工比较，不能满足源稿或最终变体正式闸门。子智能体必须逐个完成冒烟、Schema、权限、故障与黄金样本验收后，由人工在版本化清单中提交 `rolloutMode=ENFORCING`、`rolloutApprovedBy` 和 `rolloutApprovedAt`。缺少批准字段时 Bootstrap 拒绝启动。

## 2. 统一启动

启动顺序：Registry 和 Manifest 校验 → Store → Runtime → 七个 Handler → ENFORCING/Handler 一致性 → 未完成任务恢复 → Health。

`TeamRuntimeHealth` 显示 Handler、SHADOW/ENFORCING、存储和 HostRuntime 状态。七个 Handler 都存在但宿主没有注入模型时，状态为 `DEGRADED`；可以读取历史，但模型任务失败关闭。ENFORCING 角色缺 Handler 或存储损坏时状态为 `NOT_READY` 并拒绝启动。

噜噜猫通过固定工作区内的 `tools/build_daily_radar.py` 适配：`execFile`、无 Shell 拼接、120 秒超时、64KB 输出上限、最小环境变量、路径边界、READY、Schema 和哈希校验。候选阶段不增加联网深研。

## 3. 协调流程

```text
Preflight + Perspective + KnowledgeSnapshot
→ 依古比古（需要时）
→ 玛卡巴卡写前
→ 唔西迪西 DraftProposal
→ 004登记正式 ContentVersion
→ 玛卡巴卡写后
→ 莉莉丝完整审核
→ 确定性问题路由
→ 企业方批准源稿
→ 巴啦啦按渠道生成
→ 每个变体交莉莉丝轻审
→ 企业方绑定 VariantApprovalManifest 批准
→ 进入既有 ContentPackage 内容域闸门
```

DAG 的依赖不只是顺序：前序 TaskResult 的 ArtifactRef 会进入后序输入。任何任务都固定声明 Agent、Schema、依赖、Skill 快照、输入哈希、版本、权限和幂等键。模型不能新增 Agent 或自行决定路由。

莉莉丝问题按固定表路由：公开事实→依古比古；企业知识/Nomos→玛卡巴卡；逻辑/AI味/写作→唔西迪西；SEO/GEO→小点点；渠道结构→巴啦啦；P0/授权/冲突→人工。路由结果和 GEO/SEO Request 保存为 Artifact。自动完整复审最多两轮，超过后人工接管。

## 4. 人工闸门

人工决定是不可变对象，绑定 `artifactId + artifactHash`、组织、Run、用户、时间和幂等键。Artifact 必须属于同组织和同一 Run。内容变化或哈希变化会使旧决定失效。

强制闸门：

- `PERSPECTIVE_CONFIRMED`：由既有 Preflight/Perspective 流程产生；
- `SOURCE_DRAFT_APPROVED`：只能绑定 004 创建、且已通过玛卡巴卡写后和莉莉丝完整审核的 ContentVersion Artifact；
- `FINAL_VARIANTS_APPROVED`：只能绑定聚合五渠道提案及轻审结果的 `variant_approval_manifest`；
- `KNOWLEDGE_CONFLICT_DECIDED`：只允许企业人工处理。

004 和所有子智能体均不能生成 HumanGateDecision。最终 `ContentPackage` 仍必须通过既有内容域的 APPROVED、Validation、Claim/Evidence、派生版本和版权闸门；TeamRun 的批准不能绕过这些规则。

## 5. 持久化与恢复

本地 Store 保存 Task、不可变 TaskResult、Artifact、Checkpoint、HumanGateDecision、TeamRun 和追加式 Event。写入使用临时文件、Schema/哈希检查、原子改名；每 Mission 使用哈希化文件锁，崩溃遗留锁五分钟后才可回收。

恢复规则：成功且哈希一致的步骤不重跑；`WAITING_HUMAN` 保持暂停；过期租约在预算内回到 READY；活动租约、缺输入和哈希错误失败关闭。暂停不会消耗模型重试预算；取消和正在返回的 Handler 不得重复写 TaskResult。

生产迁移 `010_agent_team_runtime.sql` 增加 TeamRun、Task、Result、Artifact、Checkpoint、HumanGateDecision、Event 和 Mission Lock。Artifact、Result、Decision 由数据库触发器禁止 UPDATE/DELETE。API 只创建和排队任务，Worker 执行；API 在入队前强制 flush Store，避免 Redis 消息早于 PostgreSQL 事务可见。

## 6. 并发、重试与安全

本地模型并发默认 1；生产默认 2；每组织硬上限默认 8。只有结构化输出失败、宿主暂不可用、超时和指定瞬态网络错误自动重试一次。Evidence、政策、权限、保密、版权和人工拒绝不自动重试。

所有 Agent 输出保存 Agent/Prompt 版本、Skill 快照、输入哈希和 rolloutMode。子智能体没有 ContentVersion 写权限和批准权限。噜噜猫子进程不继承 Cookie、Authorization 和业务密钥。

## 7. 接口

API：

```text
POST /v1/missions/{id}/team-runs
GET  /v1/team-runs/{runId}
POST /v1/team-runs/{runId}/pause
POST /v1/team-runs/{runId}/resume
POST /v1/team-runs/{runId}/cancel
POST /v1/team-runs/{runId}/source-version
POST /v1/team-runs/{runId}/human-decisions
GET  /v1/team-runs/{runId}/artifacts
GET  /v1/agents/runtime-health
```

本地 CLI：`pnpm team:run/show/pause/resume/cancel/decide/health/validate`。执行类命令必须有宿主提供的 `HOST_RUNTIME_MODULE`；没有时健康状态为 DEGRADED，禁止备用模型。

## 8. 验收和发布

发布前必须执行：`pnpm typecheck`、`pnpm test`、`pnpm lint:boundaries`、`pnpm build`、Nomos 校验、Agent rollout 校验和真实 HostRuntime 端到端回放。

静态和内存测试不能替代以下上线项：真实 Codex/JovaAI HostRuntime Bridge、PostgreSQL/Redis 故障恢复、七角色逐个 SHADOW 对比、Mission-001—004 回放、一个真实选题五渠道闭环、企业方源稿和变体批准。上述事项完成前只能发布 RC，不能宣称七个子智能体正式 ENFORCING 或生产可用。
