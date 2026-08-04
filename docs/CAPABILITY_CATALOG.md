# AGT-RSN-004 能力与 Skill 清单

## 能力边界

AGT-RSN-004 的输入是任务、策略、受众、信息、Claim、Evidence、品牌规则、政策和
内容计划；输出是经过校验、审核、版本化和打包的内容资产。

它不采集市场或平台信号，不连接发布平台，不跟踪发布状态，不做效果归因，不生成
LearningProposal。

## 领域能力

1. 内容任务拆解与 ContentBrief；
2. 基于已提供材料和 Evidence 的 ContentResearch、ResearchGap、EvidenceRequest；
3. 选题深化、角度设计和 Outline；
4. 长文、短文、社交内容和视频脚本；
5. 微信、小红书、X/Twitter、视频的格式变体；
6. 多语言、本地化和文化适配；
7. SEO、GEO、AEO、AnswerBlock 和 Schema.org 内容结构；
8. MediaPitch、专家观点、品牌内容和 PublicStatement 草稿；
9. AssetBrief、封面、插图、九宫格和视频视觉规划；
10. 宿主具备图片能力时的图片生成与资产入库；
11. Claim-Evidence、品牌、政策、敏感项、披露、版权和使用权校验；
12. 不可变版本、变体、Lineage、复用计划和批量拆分；
13. 内容工作台、内容库、版本对比、模板和导出；
14. 提交 AGT-RSN-006/人工审核并按意见定向修订；
15. 只把已批准的 ContentPackage 单向交付给下游；
16. 内容 Skill 的导入、版本、安全检查、回归测试和人工激活。
17. 内容模板版本、变量快照、批量生成、排队进度和安全取消；
18. PDF/DOCX/TXT/Markdown 来源附件的隔离上传、扫描和文本提取契约；
19. PII、Secret、Prompt Injection、富文本和图片元数据的交付前安全处理；
20. 与 AGT-003/005/006 的签名、幂等、可重试内容协作协议；
21. 全链路 Trace、运行步骤、审计事件、就绪探针和运维指标。

## 可产品化 Skill

| Skill | 主要输出 | 状态 |
|---|---|---|
| Content Brief | ContentBrief | 流水线已具备，待独立模板化 |
| Evidence-grounded Research | ContentResearch/ResearchGap | 已具备 |
| Outline | Outline | 已具备 |
| Long-form / Short-form | 正文 | 已具备 |
| WeChat Formatter | 微信文章结构 | 已具备通用变体 |
| XHS Note & Card Planner | 笔记与九宫格规划 | 已具备通用变体/视觉简报 |
| X/Twitter Post & Thread | 单帖与串文 | 已具备通用变体 |
| Video Script & Storyboard | 脚本与视觉规划 | 已具备 |
| Localization | 本地化版本 | 已具备 |
| SEO/GEO/AEO | 元信息、AnswerBlock、Schema | 已具备结构 |
| Media Pitch | MediaPitchDraft | 已具备结构 |
| Expert Voice | 专家观点稿 | 待独立 Skill 和黄金样本 |
| Public Statement | 声明/回应草稿 | 已具备结构，强制人工审核 |
| Asset Brief | 封面、插图、九宫格、视频视觉简报 | 已具备，绑定来源版本 |
| Content Reuse | ContentReusePlan | 已具备结构 |
| Claim-Evidence Validator | 事实与证据门 | 已具备 |
| Brand/Policy/Rights Gate | 交付前治理 | 执行门已具备，正式企业规则语料待接入 |
| Review Preparation | ReviewRequest 和定向修订上下文 | 已具备 |
| Package Export | JSON/Markdown/HTML/DOCX 包 | 已具备 |

“已具备通用变体”表示已经能通过统一 Schema 和宿主模型生成，但尚需将提示词、
黄金样本、品牌规则和回归集封装成独立可版本化 Skill，才能称为生产级渠道 Skill。

当前 Skill 是只包含 Manifest 和 Prompt 的内容能力包，不执行任意代码。每个版本保存
SHA-256 Manifest 摘要，导入时阻断平台连接、Secret 和 Prompt Injection，只有回归通过
且管理员人工激活后才能进入生产选择。企业来源签名和信任库属于部署加固项。
