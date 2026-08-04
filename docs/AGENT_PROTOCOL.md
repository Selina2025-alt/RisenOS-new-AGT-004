# RISEN 内容协作协议 v1.0

AGT-RSN-004 只与内容生产闭环相关的智能体通信：

- 向 AGT-RSN-003 发送 `EVIDENCE_REQUEST`，接收 `EVIDENCE_FULFILLMENT`；
- 向 AGT-RSN-006 发送 `REVIEW_REQUEST`，接收 `REVIEW_DECISION`；
- 向 AGT-RSN-005 发送 `CONTENT_PACKAGE`，接收 `HANDOFF_RECEIPT`。

协议不包含平台账号、Token、发布时间、发布任务、平台状态或效果数据。

## Envelope

```json
{
  "protocolVersion": "1.0",
  "messageId": "message_...",
  "messageType": "EVIDENCE_REQUEST",
  "sender": "AGT-RSN-004",
  "recipient": "AGT-RSN-003",
  "organizationId": "org_...",
  "traceId": "trace_...",
  "idempotencyKey": "evidence_request_...",
  "sentAt": "2026-07-29T10:00:00.000Z",
  "payload": {}
}
```

发送方对键名递归排序后的紧凑 JSON 使用 HMAC-SHA256 签名，并在
`x-risen-signature` 中传递十六进制摘要，同时传递：

- `x-risen-message-id`
- `x-idempotency-key`
- `x-trace-id`

密钥来自部署环境的 `AGENT_PROTOCOL_HMAC_SECRET`，至少 32 个字符。接收方必须：

1. 校验 Envelope Schema、sender、recipient 和 messageType；
2. 用恒定时间比较验证签名；
3. 拒绝与当前时间相差超过 5 分钟的消息；
4. 按 `messageId + idempotencyKey + organizationId` 去重；
5. 只在业务事务成功后标记 Inbox 完成，失败时释放以便安全重试。

## 出站可靠性

EvidenceRequest 和 ReviewRequest 与领域对象在同一 PostgreSQL 事务中写入 Outbox。
Worker 原子认领消息，超时或非成功响应使用指数退避，达到 12 次后进入 `DEAD`。
崩溃后超过租约的 `PROCESSING` 消息可被重新认领。

生产环境必须配置：

```dotenv
AGENT_PROTOCOL_HMAC_SECRET=至少32字符的部署密钥
AGT003_EVIDENCE_REQUEST_URL=https://agt003.example/v1/agent-protocol/evidence-requests
AGT006_REVIEW_REQUEST_URL=https://agt006.example/v1/agent-protocol/review-requests
ALLOWED_OUTBOUND_HOSTS=agt003.example,agt005.example,agt006.example
HANDOFF_BASE_URL=https://agt005.example/v1
```

## 入站端点

- `POST /v1/agent-protocol/evidence-fulfillments`

  payload 为 `{ "evidenceRequestId": "...", "fulfillment": { ... } }`。

- `POST /v1/agent-protocol/review-decisions`

  payload 为 `{ "decision": { ... } }`。

重复消息返回 `{ "duplicate": true, "messageId": "..." }`，不会重复创建 Evidence、
版本、审核决定或状态迁移。

## 内容包交付

`POST {HANDOFF_BASE_URL}/content-packages` 接收 `CONTENT_PACKAGE` Envelope。
AGT-RSN-005 必须幂等处理固定的 `messageId` 和 `idempotencyKey`，并返回带签名的：

```json
{
  "protocolVersion": "1.0",
  "messageId": "receipt_message_...",
  "messageType": "HANDOFF_RECEIPT",
  "sender": "AGT-RSN-005",
  "recipient": "AGT-RSN-004",
  "organizationId": "org_...",
  "traceId": "trace_...",
  "idempotencyKey": "receipt_...",
  "sentAt": "2026-07-29T10:00:01.000Z",
  "payload": {
    "receipt": {
      "receiptId": "receipt_...",
      "packageId": "package_...",
      "contentHash": "sha256...",
      "acceptedAt": "2026-07-29T10:00:01.000Z",
      "receiver": "AGT-RSN-005"
    }
  }
}
```

AGT-RSN-004 会校验签名、组织、发送方、packageId 和 contentHash。交付调用使用固定
幂等键、15 秒超时和最多 3 次短重试。`DELIVERED` 仅表示下游已接收不可变内容包。
