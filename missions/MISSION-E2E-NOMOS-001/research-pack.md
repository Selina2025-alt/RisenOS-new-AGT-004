# Research Pack｜MISSION-E2E-NOMOS-001

- 研究主题：为什么企业多智能体协同需要制度智能体
- 研究日期：2026-08-21
- 执行角色：依古比古（public-researcher）
- 研究方式：公开网络只读；未发送内部资料或未公开信息
- 资料数量：11
- 来源类型：政府标准/监管、协议规范、安全指南、企业技术研究、学术论文
- 证据边界：外部资料只支持行业问题，不证明 Nomos 产品能力

## 核心研究结论

当多个智能体能够读取企业数据、调用工具、互相委派并持续执行任务时，单个智能体的提示词约束不足以承担全部治理责任。企业还需要横跨身份、权限、协同、证据、人工权力和追溯的运行规则。

## 公开资料

1. NIST, [AI Agent Standards Initiative](https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative), 2026-02-17。支持身份、授权、安全互操作和多智能体交互正在成为标准化重点。
2. NIST NCCoE, [AI Agent Identity and Authorization Concept Paper](https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent/ipd), 2026-02-05。支持身份、委托、授权范围、审计和不可抵赖要求；仍属概念文件。
3. NIST, [AI RMF Generative AI Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence), 2024-07-26。支持角色责任、来源记录、人类监督、版本和事件留存。
4. OWASP, [Multi-Agentic System Threat Modeling Guide v1.0](https://genai.owasp.org/resource/multi-agentic-system-threat-modeling-guide-v1-0/), 2025-04-23。支持共享记忆、通信、委派和级联失败风险。
5. Google Research, [Google’s Approach for Secure AI Agents](https://research.google/pubs/an-introduction-to-googles-approach-for-secure-ai-agents/), 2025-05。支持明确人类控制者、限制能力权限和行动可审计。
6. Linux Foundation A2A, [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/), 2025-11-09。支持能力声明、任务生命周期、认证授权、追踪和人工介入。
7. Model Context Protocol, [Authorization Specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index), 2026-07-28。支持资源级授权、最小权限和令牌边界。
8. OpenAI, [A Practical Guide to Building Agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)。支持风险分级、失败阈值、有限重试和人工接管。
9. ETH Zurich 等, [AgentDojo](https://proceedings.neurips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract.html), NeurIPS 2024。支持外部工具结果和内容可能通过间接提示注入影响智能体。
10. Microsoft Research, [Magentic-One](https://arxiv.org/abs/2411.04468), 2024-11-07。支持调度者、任务账本、进度账本、停滞计数和最大尝试限制。
11. European Union, [AI Act Article 14](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng), 2024-06-13。支持高风险AI的人类监督、干预和停止能力；不得扩大适用于所有智能体。

## 可支持的外部 Claim

- EXT-001：智能体规模化进入企业后，身份、授权和审计正在成为标准化重点。
- EXT-002：多智能体增加共享记忆、通信、委派和级联失败等系统级风险。
- EXT-003：自主性越强，越需要明确的人类控制者、最小权限和可观察行动。
- EXT-004：多智能体协作需要任务状态、能力声明、调度、停止条件和可恢复机制。
- EXT-005：外部资料、工具结果和智能体间消息应作为待验证数据，而不是可信指令。
- EXT-006：企业AI治理需要保存来源、版本、责任主体、审核决定和运行记录。

## 证据缺口

- 未发现独立第三方对 Nomos 的公开测试或审计。
- 未发现可公开核验的 Nomos 生产客户案例和量化指标。
- “制度智能体”尚不是公开标准化品类。
- 外部资料不能把 Human API、Institutional Intelligence Layer 或分布式 AGI 转化为成熟产品事实。
- 古希腊 Nomos 词源仍需独立语言学或古典文献核验。

