# GitHub 复用评估

评估日期：2026-07-29。候选项目均需在纳入前完成许可证、供应链、安全、维护活跃度
和中文场景验证，不能仅因为开源就直接进入生产。

## 建议优先纳入

| 缺口 | 候选项目 | 纳入方式 |
|---|---|---|
| 内容黄金样本、回归和红队 | [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) | 自定义 Provider 调用 HostRuntime，禁止另配模型 API |
| 正式策略执行 | [open-policy-agent/opa](https://github.com/open-policy-agent/opa) | 将 Brand/Policy 规则编译为 WASM 或作为内网策略服务 |
| 端到端可观测性 | [open-telemetry/opentelemetry-js](https://github.com/open-telemetry/opentelemetry-js) | API、Worker、队列、宿主模型桥接统一 traceId |
| 生产级富文本编辑 | [ueberdosis/tiptap](https://github.com/ueberdosis/tiptap) | 替换基础 textarea，增加段落锚点和批注 |
| 版本差异 | [kpdecker/jsdiff](https://github.com/kpdecker/jsdiff) | 文本版本 Diff；结构化对象另做字段级 Diff |
| Markdown/HTML 结构处理 | [unifiedjs/unified](https://github.com/unifiedjs/unified) | 用 AST 做导出、结构校验和安全清洗 |

## 评估后纳入

| 缺口 | 候选项目 | 约束 |
|---|---|---|
| PII 发现与脱敏 | [data-privacy-stack/presidio](https://github.com/data-privacy-stack/presidio) | 需补中文识别器、误报基线和内网部署 |
| Skill/代码静态安全 | [semgrep/semgrep](https://github.com/semgrep/semgrep) | 主要适用于未来允许代码型 Skill 时 |
| 依赖漏洞 | [google/osv-scanner](https://github.com/google/osv-scanner) | 纳入 CI 和镜像构建门 |
| 超长/跨服务可靠工作流 | [temporalio/sdk-typescript](https://github.com/temporalio/sdk-typescript) | 先确认 JovaAI 是否已提供耐久工作流，避免重复建设 |

## 不从 GitHub 直接解决

- Codex/JovaAI 模型桥接：必须由宿主实现，开源仓库不能赋予本地服务调用宿主模型的权限；
- AGT-RSN-003/006/005 契约：属于 RISEN 家族领域协议，需要本项目联合定义；
- 企业 BrandRule、版权授权和危机审批矩阵：属于企业治理资产；
- 内容黄金样本和验收标准：必须使用真实品牌、语言和风险场景建设。

## 推荐落地顺序

1. HostRuntime、AGT-003/006/005 契约和黄金样本；
2. Promptfoo、OpenTelemetry、OPA；
3. Tiptap、jsdiff、unified；
4. OSV Scanner、Semgrep、Presidio；
5. 仅在宿主无耐久工作流时评估 Temporal。

## 当前接入状态

- 已接入：Promptfoo 宿主回归 Provider、OPA 内容策略服务、OpenTelemetry、
  Tiptap、jsdiff、unified/rehype-sanitize、OSV-Scanner GitHub Workflow；
- 保留现有 RuleBasedPolicyPort 仅用于本地开发和单元测试，生产强制配置 OPA；
- 待企业数据后接入：Presidio 中文 PII；
- 待开放代码型 Skill 后接入：Semgrep；
- 待 JovaAI 工作流能力确认后决定：Temporal。
