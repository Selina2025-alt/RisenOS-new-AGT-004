# 产业 AI 五篇系列｜联合 ClaimEvidencePlan

> 任务：`SERIES-20260822-INDUSTRIAL-AI`  
> 生成角色：玛卡巴卡（只读知识匹配）  
> 状态：`PROPOSED_NOT_ACTIVATED`  
> 用途：把企业已激活 Claim 与依古比古的外部 `EXT` Claim 绑定为逐篇写作证据计划。  
> 硬边界：外部资料只证明行业背景、政策、研究结果或工程原则，不能反向证明艾氪智能产品能力、客户结果或领先性。

## 1. Topic ID 修正复核

复核结果：`PASS_WITH_SEMANTIC_OVERLAY`。

- `knowledge-snapshot.json` 实际 SHA-256：`8d59f8f0234dc3eedf6a2d24af3f73e77f35ad45c44cad236542504aabfad540`，与 004 给定值一致。
- `topic-id-migration-map.json` SHA-256：`99626d5b32f5cbe01f992eef5bee42bdd9ce18a28c9d57d5209687f4f5cdd617`。
- 五个 Topic ID 均同时存在于 Series Manifest、TopicSnapshot、KnowledgeSnapshot、Research Manifest 和迁移后知识文件中。
- 五个 Research Pack 的实际哈希均与 `research-manifest.json` 一致。

正式映射：

| Topic ID | 选题 |
|---|---|
| `TOPIC-INDUSTRIAL-AI-001` | AI 工具遍地，艾氪智能为什么聚焦实体产业？ |
| `TOPIC-INDUSTRIAL-AI-002` | AI 为什么总在演示里很好用，一进业务就失灵？ |
| `TOPIC-INDUSTRIAL-AI-003` | 从 AI 工具到产业级 Agentic OS，企业中间缺了什么？ |
| `TOPIC-INDUSTRIAL-AI-004` | AI 员工不是多一个账号：硅基人才将怎样改变产业链协作？ |
| `TOPIC-INDUSTRIAL-AI-005` | 未来三年，传统企业用好 AI，先做好哪几件事？ |

### 需要覆盖的旧融合提示

不可变 KnowledgeSnapshot 中，`TOPIC-INDUSTRIAL-AI-002` 仍保存旧的 `Nomos已演示的制度协同机制` 可选融合提示。该提示在本计划生效后仅作为历史快照内容，不再用于写作调度。原因：本系列新的任务级边界要求 Topic 1、2、5 不植入 Nomos。

## 2. Nomos 路由矩阵

| Topic | Nomos 规则 | 可执行要求 |
|---|---|---|
| 001 | `FORBIDDEN_INSERTION` | 不出现 Nomos 名称、能力、案例或类比。制度/权限只能作为通用企业条件。 |
| 002 | `FORBIDDEN_INSERTION` | 不用 Nomos 举例，不将演示能力作为落地证明。 |
| 003 | `PRIMARY_TOPIC_ONLY` | 唯一可主讲 Nomos 的篇目；保持产品组合轴与技术架构轴分离，并按演示/正式状态表达。 |
| 004 | `OPTIONAL_SINGLE_SENTENCE` | 全文最多一句承接制度与人工边界；可完全不提；不得展开功能、案例或产品说明。 |
| 005 | `FORBIDDEN_INSERTION` | 不出现 Nomos；行动清单保持产品中立，再整体连接智能体团队/JovaOS。 |

## 3. 任务级工作定义

以下定义只对 `TOPIC-INDUSTRIAL-AI-004` 当前任务有效，不写入或升级为正式知识库事实：

### AI 员工

> 本文所说的“AI 员工”，是对承担明确任务、在有限权限和制度边界内调用工具、接受人工监督与接管的智能体角色的传播性称呼。

限制：

- 不是劳动法意义上的员工；
- 不是独立法律责任主体；
- 不证明全部智能体已经生产上线；
- 不意味着无需管理、无需授权或只需看结果。

### 硅基人才

> 本文暂用“硅基人才”描述可被配置到特定角色、承载技能并参与协作的智能体能力单元。

限制：

- `TASK_SCOPED_EDITORIAL_DEFINITION`，首次出现必须说明是本文工作定义；
- 不是艾氪智能已冻结的正式产品类别；
- 不是法律身份、员工关系、生命形态或独立责任主体；
- 不得外推为 Wtree 已建成成熟“硅基人才市场”。

## 4. Coverage Exception 类型

| 类型 | 适用情况 | 处理建议 |
|---|---|---|
| `NONE` | Claim 与 Evidence 完整匹配 | 可按安全措辞进入草稿 |
| `COMPANY_FIRST_PARTY_CLAIM` | 企业方已确认定位、产品结构或数据 | 明确为企业自有口径；高风险发布场景补公开证据包 |
| `EXTERNAL_CONTEXT_ONLY` | 外部材料只支持行业背景 | 不得反向证明产品能力、客户结果或领先性 |
| `EDITORIAL_FRAMEWORK` | 多来源归纳出的文章框架 | 使用“我们认为/可以从……看”；不得冒充单一来源原话或统一标准 |
| `FORWARD_LOOKING_VIEW` | 未来趋势或产业变化判断 | 使用“可能/正在出现/值得关注”；不得给确定时间表、比例或结果 |
| `TASK_SCOPED_DEFINITION` | 当前文章为理解而设的工作定义 | 仅限指定 Topic，首次出现披露，不沉淀为企业事实 |
| `DEMONSTRATED_ONLY` | 产品能力只有演示证据 | 必须写“已演示/在演示中”，不得写成生产客户成果 |
| `PUBLICATION_REVERIFY` | 政策、官网或版本敏感材料 | 正式发布前重新核验原始页面、日期和当前版本 |
| `EVIDENCE_GAP_BLOCK` | 客户、量化结果、上线状态或领先性证据不足 | 删除或暂停，先建立 ResearchGap/EvidenceRequest |
| `NO_PRODUCT_INSERTION` | 主题无需具体产品植入 | 保持方法论表达，禁止为了 SEO/GEO 硬插产品 |

## 5. 执行顺序

```text
Research Pack
→ 本目录 ClaimEvidencePlan
→ 唔西迪西只按 Plan 生成 DraftProposal
→ 004 建立逐 Claim Binding
→ 玛卡巴卡成文后复查
→ 莉莉丝审核事实、逻辑、AI味儿与合规
→ 企业方批准
```

任何草稿如出现本计划没有覆盖的新产品能力、客户、数字、外部推断或 Nomos 越界，必须新增 `ResearchGap`，不能依靠模型补写。

