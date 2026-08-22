# Research Pack｜TOPIC-INDUSTRIAL-AI-002

## 选题

**AI 为什么总在演示里很好用，一进业务就失灵？**

研究目标：解释从模型演示、概念验证到真实业务持续运行之间的断层，避免把落地失败简单归因于模型“不够聪明”。

## 建议论证角度

演示通常验证有限输入下的能力，真实业务则要求解决正确问题、接入可信数据、理解上下文、适配既有系统、处理异常、符合权限与合规要求，并用业务指标持续验证。落地难是技术与组织共同问题。

## Sources

### PUB-001｜RAND：The Root Causes of Failure for Artificial Intelligence Projects

- 发布者：RAND Corporation
- 日期：2024-08-13
- URL：https://www.rand.org/pubs/research_reports/RRA2680-1.html
- DOI：https://doi.org/10.7249/RRA2680-1
- Source Role：`primary_research`
- 方法：访谈 65 位有经验的 AI 工程师和研究人员，其中产业访谈覆盖 50 位参与者、50 多个组织。
- 支持：五类主要失败原因包括问题和指标理解错误、数据不足、追逐新技术而非用户问题、基础设施不足、把 AI 用在超出技术能力的问题上。
- 限制：研究聚焦 AI/ML 项目，并明确不把只使用预训练 LLM 的简单提示工程作为主要研究范围；“80%项目失败”是报告引用的其他估计，不能写成 RAND 自己测得。

### PUB-002｜MIT CISR：企业 AI 从试点走向规模化

- 发布者：MIT CISR
- 日期：2025-08-21
- URL：https://cisr.mit.edu/publication/2025_0801_EnterpriseAIMaturityUpdate_WoernerSebastianWeillKaganer
- Source Role：`primary_research`
- 支持：试点到规模化需要战略、系统、组织协同和治理同步成熟；报告强调解决业务问题而非“AI问题”。
- 限制：不能把研究案例的财务结果移植到艾氪智能或其客户。

### PUB-003｜NIST AI RMF Generative AI Profile

- 发布者：美国国家标准与技术研究院 NIST
- 日期：2024-07-26；页面更新：2026-04-08
- URL：https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- DOI：https://doi.org/10.6028/NIST.AI.600-1
- Source Role：`primary_standard_guidance`
- 支持：生成式 AI 风险管理应贯穿设计、开发、使用和评估过程，使用 Govern、Map、Measure、Manage 的生命周期框架。
- 限制：自愿性框架，不是针对某个企业产品的认证，也不能证明实施结果。

### PUB-004｜《智能体规范应用与创新发展实施意见》

- 发布者：国家互联网信息办公室等三部门
- 日期：2026-05-08
- URL：https://www.cac.gov.cn/2026-05/08/c_1779979789523320.htm
- Source Role：`primary_policy`
- 支持：强调实际需求牵引、先易后难、技术验证、产品迭代、安全可控，以及任务理解、规划、工具使用、长期记忆和群体协同等基础能力。
- 限制：是规范与发展方向，不是对市场上某一系统落地效果的评测。

## Claim—Evidence Map

### EXT-002-01｜事实

**Claim：** AI 项目失败往往不是单一模型问题，而与业务问题定义、数据、基础设施、组织沟通和技术适用边界同时有关。

- Evidence：PUB-001、PUB-002
- 强度：高

### EXT-002-02｜事实归纳

**Claim：** 概念验证进入持续业务运行，需要从一次性输出扩展到生命周期治理、测量、异常处理和责任边界。

- Evidence：PUB-002、PUB-003、PUB-004
- 强度：中高
- 可写边界：属于跨框架归纳，不能冒充单一来源结论。

### EXT-002-03｜观点

**Claim：** “演示效果很好”验证的是能力片段，“业务可用”验证的是一个可持续运行的系统。

- Evidence：由 PUB-001—004 支持的艾氪智能官方解释框架。
- 强度：中高
- 类型：`official_viewpoint`

## 事实与观点区分

- 事实：RAND 研究识别了五类失败根因；MIT CISR 提出了试点到规模化的四类挑战；NIST 给出生命周期风险管理框架。
- 观点：将“能力片段”和“业务系统”作为文章核心对照，是艾氪智能的解释方式。
- 谨慎数据：不要使用“80% AI 项目失败”作标题核心数据，除非追溯并核验 RAND 所引用的原始调查。

## 证据缺口

1. 艾氪智能自身从试点到生产的正式实施方法和可公开步骤。
2. 可公开说明的异常处理、权限、审计、持续运行或多智能体协同证据。
3. 授权客户案例或匿名 CaseEvidenceCard。
4. “如何解决”只能写成方法与机制；缺少客户结果时不能写“已经解决行业共性问题”。

## 风险

- 把所有落地失败归因于客户数据或客户组织，形成甩责语气。
- 把通用工程原则包装成艾氪独有发明。
- 为了产品植入而跳过问题分析，变成产品说明书。
- 把“工作流”作为公司定位；如需使用，只能在比较传统固定流程与智能体自主执行时出现。

