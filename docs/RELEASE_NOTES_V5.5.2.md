# AGT-RSN-004 V5.5.2 发布说明

## 状态

```text
Version: 5.5.2
Status: DEVELOPMENT
Previous: 5.5.1
Date: 2026-08-24
Git tag: 待提交并推送时创建
```

## 触发原因

企业方对 `TOPIC-INDUSTRIAL-AI-002` 人工修订后提出：莉莉丝必须识别车轱辘话，删除换词复述，并审核公众号长文是否有故事推进和真人分享感。

该要求改变莉莉丝审核能力、ReviewIssue模块、团队协调器请求项、Prompt和机械审核算法，属于项目PATCH版本，不只是文章版本。

## 项目变化

- ReviewIssue新增 `repetition` 和 `narrative_quality`；
- 新增 `reviewRepetition()` 与 `reviewNarrativeQuality()`；
- 莉莉丝完整审核和变体轻审加入重复、故事性、真人表达约束；
- 明确关键概念的必要呼应不等于重复；
- 禁止为了故事性虚构客户、人物或第一人称经历；
- Windows CRLF段落切分纳入测试；
- 项目版本、Registry、Agent和Artifact Prompt版本统一到V5.5.2；
- 版本不一致时启动前校验失败。

## 数据与兼容性

- 无数据库迁移；
- 无公共API删除；
- `ReviewIssue.module`为向后兼容扩展；
- 旧审核报告保持不可变，不自动重写；
- 新规则只作用于V5.5.2之后创建的审核任务。

## 风险控制

- 重复检查默认WARN；只有重复严重阻塞论证时才升级为P1；
- 通过“是否新增事实、机制、场景、决策或边界”防止误删必要信息；
- 叙事建议只能使用可验证事实、明确假设或公开案例；
- 莉莉丝仍然不能写ContentVersion或自我批准。

## 验证

- Core tests：56/56 PASS；
- TypeScript typecheck：PASS；
- Word输出可打开、ZIP结构通过、人工渲染检查通过；
- 项目版本一致性由 `pnpm team:validate`校验。

## 回滚

回滚目标为 `v5.5.1`。回滚只切换代码、Registry和Prompt，不删除V5.5.2产生的反馈规则、审核报告、知识快照和内容Artifact。
