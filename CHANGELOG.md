# AGT-RSN-004 Changelog

项目版本遵循 [`docs/VERSIONING_POLICY.md`](docs/VERSIONING_POLICY.md)。内容资产版本、知识包版本和项目版本互相独立。

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
