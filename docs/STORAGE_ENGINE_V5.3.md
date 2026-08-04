# STORAGE_ENGINE_V5.3

## LocalFileRepository

JSON 使用 UTF-8；写入临时文件后 Schema 校验、原子改名；不可变版本使用内容哈希文件名；审计使用追加 JSONL；文件锁防止并发覆盖；失败不删除历史文件；磁盘达到阈值只提示归档。

## PostgreSQL

所有业务表带 `organization_id`；`content_versions` 禁止 UPDATE/DELETE；`content_hash` 唯一；版本号按资产递增；Outbox 与业务对象同事务；Inbox 按 messageId、幂等键和组织去重。

## Redis/BullMQ

用于任务队列、批处理、延迟重试、并发、租约、取消、死信和积压指标。Redis 不作为正式业务数据源。

## S3/MinIO

保存图片、附件、研究附件和导出包；每项保存 checksum、MIME、字节数、rights、scanStatus 和 metadataCleaned。非 CLEARED 资产不能打包。
