# AGT‑RSN‑004 内容域边界

## 允许的外部连接

- 大模型 Provider；
- 图片生成 Provider；
- AGT‑003 Context/Evidence 服务；
- AGT‑006 Review 服务；
- 内部下游 ContentPackage 接收服务；
- PostgreSQL、Redis 和 S3 兼容对象存储。

所有 HTTP 主机必须出现在 `ALLOWED_OUTBOUND_HOSTS` 中。

## 永久禁止的连接

- 微信、小红书、X/Twitter、抖音、TikTok 等发布接口；
- 平台账号和授权接口；
- 发布状态轮询和 Webhook；
- 平台内容监测接口；
- 曝光、互动、转化和归因数据接口。

即使上述主机被错误加入白名单，`assertOutboundAllowed` 也会优先按照拒绝列表阻断。

## ContentPackage 白名单

ContentPackage 可以包含：

- 已审核 ContentVersion；
- 内容格式变体和 Localization；
- 图片及其他内容资产；
- Claim—Evidence 映射；
- Validation 结果；
- 版权和使用限制；
- 标题、摘要、标签、格式建议；
- 内容哈希和版本号。

ContentPackage 不得包含：

- `accountId`、`accountRef`；
- `accessToken`、`cookie`；
- `publishAt`、`scheduledAt`；
- `publishStatus`；
- `platformContentId`、`platformUrl`；
- `impressions`、`engagement`、`conversions`。

核心服务在打包和交付两个阶段都会递归检查这些字段。

## 与其他智能体的契约

- AGT‑003：提供经过验证的 Evidence；AGT‑004 只发送 EvidenceRequest；
- AGT‑006：接收 ReviewRequest，返回 ReviewDecision；
- AGT‑005：只接收 ContentPackage；发布和发布后状态不回传给 AGT‑004；
- AGT‑007：市场、竞品和趋势信号不进入 AGT‑004 的采集范围。

AGT‑004 的最后状态是 `DELIVERED`。它表达“内容包已交付”，不表达“内容已发布”。
