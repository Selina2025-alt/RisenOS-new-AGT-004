# Research Pack V2｜MISSION-E2E-NOMOS-001

- 父版本：`research-pack.md`
- 修订原因：为每条公开资料登记不可变Evidence ID，供ClaimBindingSnapshot解析
- 研究日期：2026-08-21
- 执行角色：依古比古（public-researcher）
- 证据边界：外部资料只支持行业问题，不证明Nomos产品能力

## Evidence Index

### RP-001｜NIST AI Agent Standards Initiative

- URL：https://www.nist.gov/artificial-intelligence/ai-agent-standards-initiative
- 发布者：NIST
- 日期：2026-02-17
- Source Role：primary
- 支持：身份、授权、安全互操作和多智能体交互正在成为标准化重点。
- 限制：标准倡议，不是完整强制标准，不构成Nomos背书。

### RP-002｜AI Agent Identity and Authorization Concept Paper

- URL：https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent/ipd
- 发布者：NIST NCCoE
- 日期：2026-02-05
- Source Role：primary
- 支持：智能体身份、委托、授权范围、审计和不可抵赖。
- 限制：征求意见阶段概念文件。

### RP-003｜NIST AI RMF Generative AI Profile

- URL：https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- 发布者：NIST
- 日期：2024-07-26
- Source Role：primary
- 支持：角色责任、来源记录、人类监督、版本与事件留存。
- 限制：面向生成式AI整体，并非专为多智能体设计。

### RP-004｜OWASP Multi-Agentic System Threat Modeling Guide v1.0

- URL：https://genai.owasp.org/resource/multi-agentic-system-threat-modeling-guide-v1-0/
- 发布者：OWASP GenAI Security Project
- 日期：2025-04-23
- Source Role：primary
- 支持：共享记忆、智能体通信、任务委派和级联失败风险。
- 限制：社区安全指南，不是法律或国际标准。

### RP-005｜Google’s Approach for Secure AI Agents

- URL：https://research.google/pubs/an-introduction-to-googles-approach-for-secure-ai-agents/
- 发布者：Google Research
- 日期：2025-05
- Source Role：primary
- 支持：明确人类控制者、限制能力权限、行动可观察和可审计。
- 限制：企业方法论，不是独立行业标准。

### RP-006｜A2A Protocol Specification

- URL：https://a2a-protocol.org/latest/specification/
- 发布者：Linux Foundation A2A
- 日期：2025-11-09
- Source Role：primary
- 支持：能力声明、任务生命周期、认证授权、追踪和人工介入。
- 限制：互操作协议不等于完整企业治理体系。

### RP-007｜MCP Authorization Specification

- URL：https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index
- 发布者：Model Context Protocol
- 日期：2026-07-28
- Source Role：primary
- 支持：资源级授权、最小权限和令牌边界。
- 限制：主要解决客户端与工具服务间授权。

### RP-008｜A Practical Guide to Building Agents

- URL：https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- 发布者：OpenAI
- 日期：页面未稳定标注；检索日2026-08-21
- Source Role：primary
- 支持：风险分级、失败阈值、有限重试和人工接管。
- 限制：厂商工程建议，不构成标准。

### RP-009｜AgentDojo

- URL：https://proceedings.neurips.cc/paper_files/paper/2024/hash/97091a5177d8dc64b1da8bf3e1f6fb54-Abstract.html
- 发布者：ETH Zurich等；NeurIPS 2024
- 日期：2024-06-19
- Source Role：primary
- 支持：外部工具结果和第三方内容可能通过间接提示注入影响智能体。
- 限制：重点是提示注入，不直接研究企业制度。

### RP-010｜Magentic-One

- URL：https://arxiv.org/abs/2411.04468
- 发布者：Microsoft Research
- 日期：2024-11-07
- Source Role：primary
- 支持：调度者、任务账本、进度账本、停滞计数和最大尝试限制。
- 限制：不能证明已经解决企业治理和商业价值问题。

### RP-011｜EU AI Act Article 14

- URL：https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng
- 发布者：European Union
- 日期：2024-06-13
- Source Role：primary
- 支持：法规界定的高风险AI需要人类监督、干预和停止能力。
- 限制：不得扩大为所有企业智能体均受同样条款约束。

## Claim—Evidence Map

- EXT-001 → RP-001、RP-002
- EXT-002 → RP-004、RP-009
- EXT-003 → RP-002、RP-005、RP-008、RP-011
- EXT-004 → RP-006、RP-007、RP-010
- EXT-005 → RP-004、RP-007、RP-009
- EXT-006 → RP-002、RP-003、RP-005

