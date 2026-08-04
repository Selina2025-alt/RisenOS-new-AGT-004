# AGT-RSN-004 Storage Engine V4.0

## LocalFileRepository

本地模式实现统一 `ContentRepository` 端口的文件适配器。每类实体按 `organizationId/entityId` 存放 JSON；内容版本、审核报告、研究包和变体额外生成 Markdown 人工审阅文件。

写入算法：

```text
validate input
→ calculate content/input hash
→ write .tmp in same directory
→ fsync when available
→ atomic rename
→ append audit event
→ create READY only for complete FeedRun/research output
```

读取只接受 Schema 合法、hash 一致和 READY 存在的对象。任何 JSON 解析、hash、权限或 READY 错误均 fail-closed，不读半成品。

幂等键由 `organizationId + operation + sourceHash + requestId` 组成。重复输入返回已有对象，不重复创建版本、审核或交付。

## PostgreSQL

使用 JSONB 保存领域 payload，使用关系字段建立 organization、mission、asset、version、review、package、outbox 和 audit 索引。ContentVersion 触发器拒绝 UPDATE/DELETE；Outbox 与领域事务同提交；Inbox 先 claim，业务成功后 complete，失败 release。

## Redis/BullMQ

队列必须具备 jobId 幂等、租约、指数退避、取消信号、失败分类和 DEAD 队列。Worker 崩溃后回收过期租约；正在执行的模型请求使用 AbortSignal；不能安全中断时标记取消请求并等待 Step 收敛。

## S3/MinIO

上传先进入隔离区；校验 MIME、checksum、byteSize、病毒和文本提取后才能 READY。图片必须真实解码、限制像素、去元数据并重新编码。资产权利状态必须在打包前再次检查。

## 备份与恢复

生产部署要求 PostgreSQL PITR、Redis HA、S3 版本化、审计备份、恢复演练、死信重放和人工 Run 接管。恢复后使用 hash、traceId 和审计事件验证链路完整。
