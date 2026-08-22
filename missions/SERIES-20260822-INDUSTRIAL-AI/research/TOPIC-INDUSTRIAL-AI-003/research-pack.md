# Research Pack｜TOPIC-INDUSTRIAL-AI-003

## 选题

**从 AI 工具到产业级 Agentic OS，企业中间缺了什么？**

研究目标：建立从单点模型能力到企业级智能体系统所需组件的通用外部依据，同时避免把“Agentic OS”写成已有统一标准定义。

## 建议论证角度

企业真正缺少的通常不是另一个对话入口，而是把模型与企业上下文、知识、工具、身份权限、任务状态、协同协议、可观测性、风险围栏和人工确认组合成可持续系统的能力。

## Sources

### PUB-007｜OpenAI：A Practical Guide to Building Agents

- 发布者：OpenAI
- 日期：页面未稳定标注；检索日期 2026-08-22
- URL：https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- Source Role：`vendor_engineering_guidance`
- 支持：Agent 的基础组件包括模型、工具和指令；复杂系统还涉及编排、输出验证、工具风险分级、访问控制和人工介入。
- 限制：厂商工程指南，不是独立标准，也不证明任何第三方产品的实现状态。

### PUB-008｜Anthropic：Building Effective Agents

- 发布者：Anthropic Engineering
- 日期：2024-12-19
- URL：https://www.anthropic.com/engineering/building-effective-agents
- Source Role：`vendor_engineering_guidance`
- 支持：可预测、定义清楚的任务适合固定编排；需要灵活判断时才使用更自主的 Agent，并应从简单、可组合的模式开始。
- 限制：属于厂商经验总结；文章不得把它写成全行业唯一架构结论。

### PUB-009｜Google：Agent2Agent Protocol

- 发布者：Google Developers Blog
- 日期：2025-04-09
- URL：https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/
- Source Role：`primary_vendor_protocol_announcement`
- 支持：跨系统的智能体需要能力发现、安全信息交换和行动协调；互操作成为企业级多智能体扩展的重要问题。
- 限制：协议公告不能替代完整的身份、权限、业务治理和运行时设计。

### PUB-010｜Linux Foundation A2A 项目

- 发布者：Linux Foundation
- 日期：2025-06-23
- URL：https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents
- Source Role：`primary_project_announcement`
- 支持：A2A 进入基金会治理，目标是跨平台、跨厂商的安全智能体互操作。
- 限制：互操作协议仍不等同于“产业级 Agentic OS”的完整定义。

### PUB-011｜北京市《关于加快智能体引领发展的若干措施》

- 发布者：北京市发展改革委等四部门
- 成文日期：2026-07-21；发布日期：2026-07-23
- URL：https://www.beijing.gov.cn/zhengce/zhengcefagui/202607/t20260723_4781085.html
- Source Role：`primary_policy`
- 支持：明确提出 Harness Engineering、上下文工程、任务持久化、多智能体协作、中间层软件栈、互联协议、开发框架、能力编排、运行管理和安全可控技术栈。
- 限制：产业政策列出的技术方向不能直接当成艾氪智能已完成功能清单。

### PUB-004｜《智能体规范应用与创新发展实施意见》

- 发布者：国家互联网信息办公室等三部门
- 日期：2026-05-08
- URL：https://www.cac.gov.cn/2026-05/08/c_1779979789523320.htm
- Source Role：`primary_policy`
- 支持：智能体基础能力包括任务理解、任务规划、工具使用、长期记忆、互认互通和群体协同，并以安全可靠可信为底线。
- 限制：不能据此宣称某产品符合全部要求。

## Claim—Evidence Map

### EXT-003-01｜事实归纳

**Claim：** 企业 Agent 系统至少需要模型、工具、指令/规则，以及上下文、任务状态、协同、权限和安全控制。

- Evidence：PUB-007、PUB-004、PUB-011
- 强度：高
- 可写边界：“至少需要”是跨来源工程归纳，不是统一标准清单。

### EXT-003-02｜事实

**Claim：** 跨智能体能力发现、通信和协作已经成为公开协议与产业基础设施的建设方向。

- Evidence：PUB-009、PUB-010、PUB-011
- 强度：高

### EXT-003-03｜观点

**Claim：** 企业需要的不是无限增加 Agent 数量，而是能让不同角色在权限、证据和人工边界下稳定协同的操作系统级能力。

- Evidence：PUB-007—011 提供行业背景；具体表述属于艾氪智能官方观点。
- 强度：中高

## 事实与观点区分

- 事实：政策和协议明确关注任务持久化、协同、工具、互操作与安全。
- 观点：“产业级 Agentic OS”是艾氪智能的类别表达，当前不存在被以上来源共同确认的唯一标准定义。
- 产品事实：JovaAI/JovaOS 的五层架构、两条产品线、四大矩阵及 Nomos 位置必须由企业知识快照证明。

## 证据缺口

1. 艾氪智能对“产业级 Agentic OS”的正式定义和公开安全表述。
2. JovaAI/JovaOS 架构的当前权威版本，尤其层级顺序与组件边界。
3. 产品已经实现的任务持久化、权限、审计、多智能体协同和人工闸门证据。
4. “全球首个”“唯一”等领先性表述所需的独立比较方法与证据。

## 风险

- 把 `Agentic OS` 写成国际标准术语或政策原文。
- 将 A2A、MCP 等单一协议等同于完整操作系统。
- 用北京政策中的技术清单反向拼出艾氪智能产品能力。
- 把 Nomos写成JovaAI第六层，或将研究方向写成已生产能力。

