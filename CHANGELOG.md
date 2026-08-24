# AGT-RSN-004 Changelog

项目版本遵循 [`docs/VERSIONING_POLICY.md`](docs/VERSIONING_POLICY.md)。内容资产版本、知识包版本和项目版本互相独立。

## [5.6.0] - 2026-08-24

### Added

- 新增第八个内部子智能体“闪闪” (`packaging-copy-agent`)；
- 新增 50–80 个候选、默认 60 个的标题候选池与独立自动选择阶段；
- 新增微信、短视频/视频号、小红书、X、LinkedIn、YouTube、播客七渠道包装契约；
- 新增标题、封面、视频上方文字、Podcast Hook、YouTube缩略图文字和标签策略；
- 新增莉莉丝包装审核模块、包装反馈和不可变人工 Override；
- 新增本地标题知识包（含176条白名单字段清洗语料）、E052—E056黄金样本和负面样本；
- 新增包装API、CLI、人工审阅书渲染和统一Artifact类型。

### Changed

- 变体工作流变为：巴啦啦正文变体 → 莉莉丝正文轻审 → 闪闪候选/选择 → 莉莉丝包装审核 → 最终变体总闸门；
- Runtime默认入口升级为 `createV56TeamRuntime`，旧入口保留为deprecated别名；
- `AgentTask.agentVersion`统一读取项目版本常量，不再硬编码5.5.0；
- API、Worker和CLI切换到V5.6统一Bootstrap；
- 标题包装不设置独立人工确认，但保留源稿和最终变体企业批准。

### Safety

- 闪闪默认只读取本地标题库，不获得任意网络、平台账号、发布或效果分析权限；
- 标题不能新增Claim、客户结果、产品能力、无证据数字或绝对承诺；
- 闪闪保持SHADOW，不能满足正式总闸门，直到另行版本化人工批准。

### Rollback

- 回滚点：`v5.5.2`（提交 `4c74698`）；
- 回滚不删除V5.6产生的包装候选、选择、反馈、Override和审计Artifact。

## [5.5.2] - 2026-08-24

### Added

- 莉莉丝新增 `repetition` 车轱辘话审核模块；
- 莉莉丝新增 `narrative_quality` 故事性与真人分享感审核模块；
- 新增重复主题分布、跨段相似和长场景空窗检测；
- 新增项目版本单一真源 `VERSION`；
- Registry、根包版本与 `VERSION` 一致性校验；
- 新增项目版本管理与回滚规则。

### Changed

- 莉莉丝完整审核和变体轻审Prompt升级到V5.5.2；
- 长文审核要求保留首次讲透的观点，删除无新增事实、机制、场景、决策或边界的同义复述；
- “真人分享感”不得通过虚构第一人称经历实现；
- Agent Artifact统一记录V5.5.2 Prompt版本；
- Word文章导出支持独立页眉，并清理Markdown单星号强调标记。

### Fixed

- 修复Windows CRLF文档无法被莉莉丝按段落切分，导致AI味、重复和叙事检查失效的问题。

### Validation

- TypeScript typecheck：PASS；
- Core tests：56/56 PASS；
- Registry、Runtime、Handler和版本一致性：必须由 `pnpm team:validate` fail-closed校验。

### Rollback

- 上一项目版本：`v5.5.1`；
- 回滚代码不得删除V5.5.2生成的内容、审核、反馈、知识快照和审计Artifact。

## [5.5.1] - 2026-08-22

- 完成七个子智能体统一Runtime Handler、团队协调器、本地恢复、人工闸门和安全Rollout接线；
- 详细内容见 [`docs/IMPLEMENTATION_PLAN_V5.5.1.md`](docs/IMPLEMENTATION_PLAN_V5.5.1.md)。

## [5.5.0]

- 建立Nomos知识治理、Mission Preflight、PerspectiveContract、KnowledgeSnapshot及七智能体团队结构；
- 详细内容见 [`docs/IMPLEMENTATION_PLAN_V5.5.md`](docs/IMPLEMENTATION_PLAN_V5.5.md)。
