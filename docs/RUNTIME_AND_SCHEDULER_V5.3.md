# RUNTIME_AND_SCHEDULER_V5.3

内部运行时使用 `AgentDefinition`、`AgentTask`、`ArtifactRef`、`AgentCheckpoint` 和 `AgentLease`。本地实现为有界调度器；生产可替换为 BullMQ/Temporal 适配器，但领域接口不变。

## 调度

- DAG 支持串行、并行、Fan-out、Join；
- 依赖完成后才进入 READY；依赖失败则 BLOCKED；
- 任务租约含 owner、acquiredAt、heartbeatAt、expiresAt；
- 租约过期进入恢复队列；
- 默认本地生成串行、变体并行度 2；
- 自动重试最多 2 次，仅针对瞬态错误；
- 支持 pause、resume、cancel；
- 使用幂等键和输入哈希阻止重复模型调用；
- 任务输出必须通过目标 Schema 校验。

## 权限

Runtime 在 dispatch 前校验 Agent 状态、允许工具、输出 Schema、组织和 Capability Token。Lilith、Xiaodiandian、Balala 的写版本和批准权限固定为 false。

## 恢复

Checkpoint 保存已完成子任务、未完成子任务、Artifact 引用和 contextHash。恢复时复用已成功且哈希一致的输出，不重复调用模型。
