# ClaimEvidencePlan｜TOPIC-INDUSTRIAL-AI-002

## 主题

**AI 为什么总在演示里很好用，一进业务就失灵？**

Nomos 规则：`FORBIDDEN_INSERTION`。KnowledgeSnapshot 中旧的 Nomos 可选融合提示由本计划覆盖，不再用于写作。

## 联合 Claim—Evidence 计划

| Plan ID | 企业 Active Claim | 外部 EXT Claim | Evidence 源 | 可用措辞 | 禁用扩大 | Coverage Exception 建议 |
|---|---|---|---|---|---|---|
| CEP-002-01 | `ENT-001/ENT-004`：艾氪智能聚焦企业AI、产业AI并帮助企业推进AI转型 | `EXT-002-01`：失败根因同时涉及业务定义、数据、基础设施、组织沟通和技术边界 | 企业：`knowledge/evidence/产品能力_案例与公开证据台账.md`；外部：`PUB-001` RAND、`PUB-002` MIT CISR | “落地难通常不是模型单点问题。RAND与MIT CISR的研究分别提示，业务问题、数据、基础设施、组织协同和治理都可能成为断点。” | 不用“80%项目失败”作为RAND自测结论；不把失败归咎于客户；不声称所有企业都相同 | `EXTERNAL_CONTEXT_ONLY` |
| CEP-002-02 | `PROD-TEAM`：智能体团队需任务、制度、数据权限、工具能力和人工决策边界 | `EXT-002-02`：持续业务运行需要生命周期治理、测量、异常处理和责任边界 | 企业：`knowledge/products/核心产品口径_两条产品线四大矩阵_V3.0.md`；外部：`PUB-002`、`PUB-003` NIST、`PUB-004` | “一次演示验证的是有限条件下的能力；持续运行还要面对权限、异常、测量、责任与治理。艾氪智能因此把智能体放在明确任务、制度和人工边界中理解。” | 不说NIST认证或验证了艾氪智能；不把通用工程原则包装成独有发明 | `EDITORIAL_FRAMEWORK` + `EXTERNAL_CONTEXT_ONLY` |
| CEP-002-03 | `S1-A03`：JovaOS用于承载和治理企业智能体及协同关系 | `EXT-002-03`：“能力片段”与“可持续业务系统”的对照是官方解释框架 | 企业：`knowledge/products/核心产品口径_两条产品线四大矩阵_V3.0.md`；外部：`PUB-001`—`PUB-004` | “从能力片段走向业务可用，需要一个能承载任务状态、数据、工具、权限和人工责任的系统环境；JovaOS是艾氪智能对此类问题的产品架构回应。” | 不写“JovaOS已解决行业共性问题”；不写所有五层均生产上线；不写客户结果 | `COMPANY_FIRST_PARTY_CLAIM` + `EDITORIAL_FRAMEWORK` |

## Coverage Exceptions 与缺口

1. **标题中的“总是/失灵”**：属于传播提问，不得在正文写成统计事实；建议解释为“为什么许多企业会感受到这种断层”。
2. **演示与生产**：当前可使用产品证据台账来说明证据状态差异，但本篇不以 Nomos 或其他单一演示当案例。
3. **客户结果缺口**：没有授权 CaseEvidenceCard，不得写“我们已经解决”；标记 `EVIDENCE_GAP_BLOCK`。
4. **Nomos**：名称、功能、演示均不出现；如出现，路由回唔西迪西删除，不转小点点硬融合。

## 最低覆盖要求

- `EXT-002-01` 必须出现并保留 RAND 研究方法和局限之一；
- `EXT-002-02` 至少绑定 NIST/MIT/政策中的两类来源；
- 企业融合只能在问题机制解释完成后出现；
- 禁止任何“演示能力=生产能力”的跨级表达。

