# AGT-RSN-004 Agent Protocol V4.0

## Message Envelope

协议版本为 1.0。Envelope 必须包含 `messageId/messageType/sender/recipient/organizationId/traceId/idempotencyKey/sentAt/payload`。

支持消息：`EVIDENCE_REQUEST`、`EVIDENCE_FULFILLMENT`、`REVIEW_REQUEST`、`REVIEW_DECISION`、`CONTENT_PACKAGE`、`HANDOFF_RECEIPT`。

## 认证和幂等

- 对键名排序后的紧凑 JSON 使用 HMAC-SHA256。
- 使用恒定时间比较校验签名。
- `sentAt` 默认只能偏离当前时间 5 分钟。
- Inbox 以 messageId、idempotencyKey、organizationId 去重。
- 重复消息返回 duplicate，不重复创建对象。
- Outbox 非成功响应指数退避，最多 12 次后 DEAD。
- ContentPackage 交付固定幂等键，15 秒超时，最多 3 次短重试。

## 协作职责

- AGT-003 提供正式 Evidence；004 只发送 EvidenceRequest。
- AGT-006 接收 ReviewRequest 并返回 ReviewDecision。
- AGT-005 只接收 ContentPackage 并返回 HandoffReceipt。
- AGT-005 不得回传发布状态、平台数据或效果指标。

## 交付边界

ContentPackage 只含已审核版本、变体、Localization、资产、Claim/Evidence、Validation、Rights、标题、摘要、标签、格式建议、hash 和版本号，不含账号、Token、发布时间、平台 ID、发布状态或效果指标。
