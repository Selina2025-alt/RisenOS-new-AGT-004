# AGT-RSN-004 独立内容工作区

本目录用于 AGT-RSN-004 在当前对话中独立运行。模型使用当前 Codex 对话模型，知识、
草稿、版本和交付文件保存在本地，不依赖前端、数据库或其他智能体。

## 当前知识入口

`knowledge/00_知识库索引.md`

当前版本为 `KB-4.0`。第二批六份大文档已经完整拆分为 474 个来源章节，并按企业战略、
品牌、产品架构、智能体能力、客户场景、案例证据、官网视觉、历史内容、竞品壁垒和
合规保密进行路由。创作时优先读取合规、保密、版本冲突和证据闸门，再读取主题资料。

批次归库总表：

`knowledge/sources/六份大批量资料拆分与归库总表.md`

合并内部知识包：

`exports/艾氪智能企业品牌产品内容知识库_V2.0_内部版.docx`

## 直接下达内容任务

可以在对话中按下面格式提供，也可以直接自然语言描述：

```text
任务：
目标：
产品/智能体：
目标受众：
渠道：
希望读者理解或采取的行动：
必须使用的资料：
不能出现的内容：
期望格式：
截止或版本：
```

缺少字段时，AGT-RSN-004 会使用本地知识继续完成；只有影响事实、合规或最终方向的
关键信息缺失时才向企业方提问。

## 热点研究与每日选题

004 现在具备两种内容情报入口：

1. 在对话中直接说“我想做一个关于……的选题”。004 会先创建本地研究任务，使用当前
   宿主提供的公开网络能力进行只读研究，形成可追溯的 Research Pack；不会调用额外模型
   API。
2. 每天读取 AI HOT、AgentReach、Follow Builders 三条资讯任务写入的本地副本，完成
   去重、事件聚类和三赛道评分，在当前对话提供 5–8 个候选。三个赛道分别为热点事件、
   人物观点、企业AI与产业AI；各自使用不同评分标准。资料不足时如实少报，不使用固定
   模板凑数。

V3 将“选题价值”和“研究准备度”分开：单一来源不会自动抹杀一个好选题，但会将其标记
为 `NEEDS_CROSS_CHECK` 或 `NEEDS_SOURCE_RECOVERY`，批准后必须先补证据。用户明确选择、
拒绝或调整排序可以记录为本地偏好反馈，但系统不会自动修改权重。

完整评分规则见 [`intelligence/SCORING.md`](intelligence/SCORING.md)。

热点能力只服务于内容创作前的选题和资料准备，不包含平台发布、账号管理、发布状态、
效果监测或 LearningProposal。

常用本地命令：

```powershell
python tools/create_research_mission.py --topic "产业级多智能体协同"
python tools/build_daily_radar.py
python tools/approve_topic.py --topic-id "T-YYYYMMDD-XXXXXXXX" --action approve
python tools/record_topic_feedback.py --topic-id "T-YYYYMMDD-XXXXXXXX" `
  --decision select --reason-tag "一手人物表达" --preferred-rank 1
python tools/validate_intelligence_workspace.py
python -m unittest discover -s tests -v
```

详细运行约定见 `intelligence/OPERATING.md`。

## 目录约定

```text
knowledge/     企业、产品、合规、证据、渠道和竞品知识
intelligence/  资讯输入、每日选题、研究包、Schema 和安全策略
missions/      内容任务与 ContentBrief
drafts/        未审核草稿
review/        待企业方审核
approved/      企业方明确批准的版本
exports/       DOCX、Markdown 等交付文件
assets/        已授权图片和视觉资产
audit/         版本、修改、批准和来源记录
restricted/    受限资料
```

当前仅创建实际已有内容的目录；其他目录会在首个任务产生对应资产时创建。
