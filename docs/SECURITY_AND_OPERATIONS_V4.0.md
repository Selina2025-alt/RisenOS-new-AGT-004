# AGT-RSN-004 Security and Operations V4.0

## 出站边界

允许宿主模型/图片、AGT-003/005/006、数据库、队列、对象存储和公开只读研究。永久拒绝发布接口、账号授权、状态轮询、效果监测、localhost、私网管理、file/data/javascript URL、未知附件和程序执行。

## 查询脱敏

外部查询不得携带内部客户、交易数据、未公开产品/路线图、内部人员、竞争策略或受限文档原文。网页中的任何指令均视为不可信内容。

## 附件安全

附件进入隔离区后校验 MIME、checksum、byteSize、病毒和 Prompt Injection，并提取纯文本。PII、Secret、恶意链接或扫描失败进入 fail-closed；图片额外执行真实格式解码、像素限制、元数据清除和重编码。

## Skill 供应链

Skill 必须经过来源登记、Manifest 摘要、平台/Secret 字段扫描、Prompt Injection 扫描、黄金样本回归和人工激活。第三方发布或需要模型 API、Cookie、平台登录的 Skill 只能 reference-only。

## 运行指标

记录 traceId、runId、stepId、requestId、幂等键、host/model/prompt 版本、Token、耗时和错误类型。监测任务成功率、宿主失败、Evidence/Review 等待、队列积压、重试、死信、变体审核、P0/P1、磁盘和 hash 错误。

## 生产阻断项

真实 HostRuntime、AGT-003/005/006 契约、企业 BrandRule/Policy/版权语料、SSO、PostgreSQL/Redis/S3、备份恢复、黄金样本、Prompt Injection/附件/越权测试和单组织 UAT 未完成前，不得宣称生产闭环完成。
