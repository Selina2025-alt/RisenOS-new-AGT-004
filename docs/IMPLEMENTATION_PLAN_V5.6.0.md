# AGT-RSN-004 标题与内容包装智能体“闪闪”实施说明 V5.6.0

## 1. 权威性与基线

V5.6.0 在已推送的 `v5.5.2`（提交 `4c74698`）之上增加独立包装阶段，不改写V5.5.2的知识、内容、审核和审计Artifact。开发分支为 `implementation/v5.6.0`。

项目版本、Registry、Agent版本、Prompt版本、README、CHANGELOG和审计必须同时升级。`v5.5.2`是回滚点；回滚不能删除V5.6产生的候选池、选择、反馈、Override或审计记录。

## 2. 团队与权限

新增：

```text
displayName = 闪闪
agentId = packaging-copy-agent
role = content_packaging_copy
```

闪闪只读取已批准源稿、已审核渠道变体、Claim/Evidence快照、本地标题语料和渠道规则；输出候选标题、渠道包装和选择理由。它不能改正文、写ContentVersion/ChannelVariant、添加事实或产品能力、自审、自批、发布、读取平台数据或任意访问网络。

V5.6.0 RC中004保持ENFORCING，八个内部子智能体均保持SHADOW。SHADOW可生成可追溯Artifact，但不能满足正式最终变体闸门。提升ENFORCING需要后续版本化人工批准。

## 3. 标准工作流

```text
SOURCE_DRAFT_APPROVED
→ 巴啦啦生成七渠道正文变体
→ 莉莉丝正文轻审
→ 004生成PackagingBrief
→ 闪闪PACKAGING_CANDIDATE_GENERATION
→ 机械硬门槛、去重和机制分布校验
→ 闪闪PACKAGING_AUTO_SELECTION
→ 莉莉丝PACKAGING_REVIEW
→ P0/P1最多自动重做一次
→ 004生成联合variant_approval_manifest
→ FINAL_VARIANTS_APPROVED
→ ContentPackage
```

不存在 `WAITING_HUMAN_TITLE_CONFIRMATION`。人工可以查看、反馈或提交不可变Override，但标题环节不是单独阻断闸门。源稿和最终变体总闸门保留。

## 4. 七渠道语义

| 渠道 | 正式包装字段 |
|---|---|
| 微信 | 文章标题、封面主副文案、栏目标签 |
| 短视频/视频号 | 发布标题、两行视频上方文字、封面主副文案、标签 |
| 小红书 | 笔记标题、封面主副文案、普通标签、1—2个howto标签 |
| X | Thread首条Hook、可选媒体封面文字、标签 |
| LinkedIn | Post Hook、轮播封面文字、标签 |
| YouTube | 视频标题、缩略图文字、开屏文字、标签建议 |
| 播客 | 单集标题、封面文字、描述Hook、主题标签 |

X和LinkedIn不伪造平台“标题”字段；其`primaryTitle`分别表示Thread Hook和Post Hook。播客不得生成视频上方文字。不适用字段必须在`notApplicableFields`声明。

## 5. 候选与选择

- 默认60个，允许50—80个；
- 低于50只补充生成一次，再不足则FAILED；
- 十类机制：问题、反差、好奇、利他、数字、场景、人物/产品、历史到当代、阶段跃迁、企业决策；
- 单一机制不超过25%；
- 近重复候选合并；
- 每个平台保留3个备选并自动选1个默认；
- 总入围5—8个，同机制最多2个；
- 生成和选择为两个隔离模型任务，选择阶段接收重新排序的候选，降低自我锚定。

通过硬门槛后按100分评分：兑现度20、受众15、好奇/冲突15、利他15、具体性10、品牌适配10、渠道5、标题封面互补5、人工偏好5。得分不得表述为CTR预测。

## 6. 硬门槛与莉莉丝审核

机械阻断：正文无法兑现、新事实/结论、无Evidence数字/倍数/排名、品牌拼写错误、禁用表达、未授权客户、假设冒充案例、内部信息、绝对承诺、标题/封面/开头不一致。

内置拼写：`JovaAI Nomos`正确，`JovaIAI Nomos`错误。JovaAI官方账号必须包含`#JovaAI`；小红书howto标签选1—2个，不得全量机械追加。

莉莉丝包装审核模块：

```text
title_fidelity
clickbait_risk
unsupported_number
brand_spelling
title_cover_alignment
video_overlay_alignment
tag_policy
platform_packaging
opening_payoff
candidate_diversity
```

P0/P1阻断并最多自动修订一次；P2/P3可形成`AUTO_SELECTED_WITH_WARNING`。莉莉丝不替闪闪选择、不改正文、不代替企业批准。

## 7. 持久化契约

新增不可变Artifact：

```text
packaging_brief
title_candidate_pool
auto_packaging_selection
packaging_review_report
packaging_feedback
packaging_override
title_pattern_research_pack
```

联合`variant_approval_manifest`必须绑定源ContentVersion、七渠道变体、变体审核、候选池、自动选择、包装审核和有效Override。包装Artifact变化后旧最终批准失效。候选池不进入下游ContentPackage，只有最终有效包装方案进入。

人工Override优先于最新通过审核的自动选择，但不删除自动选择；任何新文本仍须通过硬门槛。单次反馈只形成有限范围PreferenceCandidate，不自动激活全局规则，不使用平台效果自动进化。

## 8. 本地知识包

本地只读资源位于`knowledge/title-packaging/`：

- `TITLE_CORPUS_MANIFEST_V1.json`：记录《爆款标题.csv》哈希、176条有效编号记录和解析边界；
- `TITLE_CORPUS_V1.json`：只保存白名单字段清洗后的176条标题短文本、作者与来源声明指标；不包含CSV内嵌指令；
- `TITLE_PATTERN_PACK_V1.md`：十类机制及生成约束；
- `CHANNEL_PACKAGING_POLICY_V1.json`：七渠道和标签策略；
- `PACKAGING_GOLDEN_SET_V1.json`：E052—E056；
- `PACKAGING_NEGATIVE_SET_V1.json`：拼写、无证据数字、强行植入和标题不兑现样本。

CSV中的分析指令和多余列一律标为`SOURCE_CONTENT_ONLY`，不执行。互动量只保留为来源声明字段，不跨平台比较，不改变生产权重。

## 9. Runtime、API和CLI

统一入口：`createV56TeamRuntime()`；`createV55TeamRuntime`只保留deprecated兼容别名。Runtime健康必须显示8/8 Handler。API、Worker和CLI使用V5.6入口，任务版本读取统一项目版本常量。

API：

```text
GET  /v1/team-runs/{runId}/packaging
POST /v1/team-runs/{runId}/packaging-feedback
POST /v1/team-runs/{runId}/packaging-override
POST /v1/team-runs/{runId}/packaging-regenerate
```

`packaging-regenerate`默认请求体为`{"researchMode":"LOCAL_CORPUS"}`。只有用户明确要求更新公开标题趋势时才允许传入`PUBLIC_PATTERN_PACK`；协调器会先调度依古比古生成带公开URL的`title_pattern_research_pack`，再调度闪闪，且拒绝localhost和私网来源。

CLI：

```text
packaging:generate
packaging:show
packaging:feedback
packaging:override
packaging:validate
```

本地模式复用AgentTask、Artifact、Event和文件原子写入；生产模式复用现有PostgreSQL、BullMQ和Outbox，不建立第二套包装数据库。

## 10. 验收与发布

必须通过类型检查、全量测试、边界检查、8/8 Registry校验、E052—E056回放、普通行业负样本、无证据数字负样本和标题不兑现负样本。

V5.6.0 RC只证明代码、契约和SHADOW Artifact可运行；不代表闪闪已取得ENFORCING资格。正式标签与main覆盖必须在真实内容试跑、企业方验收和无P0/P1回归后执行。
