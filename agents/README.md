# AGT-RSN-004 V5.6.0 团队登记

`registry.v5.6.json` 是运行时、文档和测试的共同清单。正式团队由 004 Supervisor 与八个内部子智能体构成：噜噜猫、依古比古、玛卡巴卡、唔西迪西、莉莉丝、小点点、巴啦啦、闪闪。

闪闪的 Agent ID 为 `packaging-copy-agent`，负责标题、Hook、封面文字、视频上方文字、标签和七渠道自动包装选择。它不改正文、不创建正式版本、不自我审核、不发布。标题环节没有独立人工闸门，但仍受源稿批准和最终变体总批准约束。

所有子智能体只能提交 Artifact 或 Proposal。只有 004 能创建不可变 `ContentVersion`、`ChannelVariant` 和 `ContentPackage`；004 和子智能体都没有企业方最终对外批准权。

`rolloutMode` 含义：

- `OFF`：存在定义但不可调度；
- `SHADOW`：可调度和记录，不影响正式闸门；
- `ENFORCING`：输出参与正式闸门。

发布包中的登记值必须与 `createDefaultAgentRegistry()` 一致。`tools/validate_agent_rollout.py` 会阻止清单、代码和能力边界不一致的发布。

项目版本由根目录 `VERSION` 管理，并必须与根 `package.json`、Registry `release`、各Agent `version/manifestHash`一致。任何Agent能力、Prompt、权限、路由或审核闸门变化都必须先升级项目版本并记录到 `CHANGELOG.md`；规则见 [`../docs/VERSIONING_POLICY.md`](../docs/VERSIONING_POLICY.md)。

切换内部角色为 `ENFORCING` 必须在同一版本化清单项中增加 `rolloutApprovedBy` 和 ISO 时间格式的 `rolloutApprovedAt`。Bootstrap 从该清单加载 rolloutMode；缺少人工批准字段时拒绝启动。运行中的智能体无权修改该文件。
