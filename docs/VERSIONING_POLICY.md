# AGT-RSN-004 项目版本与回滚制度

## 1. 单一真源

项目当前版本以仓库根目录 [`VERSION`](../VERSION) 为单一真源，并必须与以下字段一致：

```text
VERSION
package.json.version
active_context.json.workspaceVersion
agents/registry.v5.5.json.release
AgentDefinition.version
AgentDefinition.manifestHash
```

`tools/validate_agent_rollout.py`发现任何漂移时必须失败，不允许带着版本不一致继续发布。

## 2. 哪些修改必须升级项目版本

以下任一变化都属于项目层变化，至少增加PATCH版本：

- 004或子智能体职责、权限、Prompt、路由和审核维度；
- 状态机、工作流、人工闸门、自动循环或失败处理；
- Schema、API、CLI、持久化结构和网络/安全策略；
- Skill的生产启用、停用或行为变化；
- 知识治理、合规、品牌和反馈规则对运行行为的改变；
- 影响正式产物的缺陷修复；
- 权威文档中的实施规则改变。

以下内容不单独升级项目版本：

- 某一篇文章的修改、审核或渠道变体；
- 单次ResearchPack、TopicSnapshot或ContentPackage；
- 未激活的原始资料入库；
- 不改变行为的错别字、排版和链接修复。

但是，如果单篇反馈被提炼并激活为系统规则，就必须升级项目版本。

## 3. 版本号规则

采用语义版本：

```text
MAJOR.MINOR.PATCH
```

- `PATCH`：兼容性缺陷修复、Prompt/审核规则增强、非破坏性Schema扩展；
- `MINOR`：新增子智能体、独立能力、工作流阶段或持久化子系统；
- `MAJOR`：删除或改变公共契约、领域边界、协议或产生不兼容迁移。

预发布使用：

```text
v5.6.0-rc.1
```

## 4. 四类版本不得混用

| 类型 | 示例 | 用途 |
|---|---|---|
| 项目版本 | `v5.5.2` | 004团队代码、规则和运行时 |
| 内容资产版本 | `ContentVersion 3` | 某篇文章或变体 |
| 知识包版本 | `nomos-canon-20260820-v1.0.0` | 企业知识和Claim集合 |
| Prompt/Skill版本 | `lilith-review-v5.5.2` | 具体生成或审核能力快照 |

Mission-001、文章v3和知识包v1.0.0不得作为项目Git标签。

## 5. 每次项目升级的必备记录

项目层修改完成前必须：

1. 确定新项目版本；
2. 更新 `VERSION`、根 `package.json`、`active_context.json`、Registry和Agent版本；
3. 更新 `CHANGELOG.md`；
4. 新增对应 `docs/RELEASE_NOTES_Vx.y.z.md`；
5. 记录变化原因、范围、数据迁移、风险、测试和回滚点；
6. 运行版本一致性、类型、测试和边界校验；
7. 提交Git时在Commit中写明版本；
8. 推送发布时创建同名Git Tag。

未提交和未推送的版本只能标记为 `DEVELOPMENT`，不得宣称Git Tag已经发布。

## 6. 回滚

- 代码回滚到上一个Git Tag；
- Registry和Prompt回滚到同一项目版本；
- 不删除新版本产生的不可变内容、知识快照、审核、人工决定和审计记录；
- 新版本Schema已写入数据时，必须使用显式向下迁移或兼容读取，禁止直接覆盖文件；
- 回滚原因和执行人追加到审计记录和Changelog。
