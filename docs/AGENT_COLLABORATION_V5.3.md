# AGENT_COLLABORATION_V5.3

004 是 Supervisor；Lilith 是审核 Agent；Xiaodiandian 是内容 GEO/SEO 优化 Agent；Balala 是渠道变体 Agent。所有子智能体都通过 Internal Agent Runtime 协作，不加入外部 AGT Recipient。

## 标准链路

```text
Writing → Lilith Review → Xiaodiandian GEO/SEO Proposal
→ 004 new ContentVersion → Lilith Re-review
→ Human Gate → Balala Variants → Lilith Light Review
→ optional Xiaodiandian → Human Gate → Package
```

## 约束

- 子智能体只写 Report、Proposal 或 Variant Artifact；
- 004 是唯一正式 ContentVersion writer；
- 所有 Agent `canApprove=false`；
- 子任务使用 Artifact 引用，不复制完整知识上下文；
- 新 Claim 必须走 EvidenceRequest；
- GEO 循环最多两轮；
- 实质变体必须完整复审；
- 初期人工 Gate 默认开启。
