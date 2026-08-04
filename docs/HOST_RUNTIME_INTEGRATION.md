# 宿主模型接入契约

## 目标

模型选择和凭据属于部署宿主，不属于 AGT-RSN-004。服务只描述“需要生成什么”，
Codex 或 JovaAI 决定“用哪个模型、如何调用、如何计费和如何执行安全策略”。

## 必须实现的接口

部署模块导出：

```ts
export async function createHostRuntime() {
  return {
    hostId: "jovaai",
    async healthCheck() {
      await jovaNativeModel.assertReady();
    },
    async generateObject(request) {
      const startedAt = Date.now();
      const output = await jovaNativeModel.generateStructured({
        schema: request.jsonSchema,
        input: request.input,
        signal: request.signal,
        idempotencyKey: request.idempotencyKey,
      });
      return {
        output,
        metadata: {
          hostId: "jovaai",
          modelId: "jova-native",
          modelVersion: jovaNativeModel.version,
          promptVersion: request.promptVersion,
          inputTokens: output.usage.inputTokens,
          outputTokens: output.usage.outputTokens,
          durationMs: Date.now() - startedAt,
          safetyStatus: "PASSED",
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
        },
      };
    },
    async generateImage(request) {
      // 可选。返回 { bytes: Uint8Array, mimeType: "image/png" }。
    },
    async prepareAttachmentUpload(request) {
      // 返回隔离区预签名 uploadUrl、objectKey、到期时间和必须的请求头。
    },
    async scanAttachment(request) {
      // 在隔离进程中校验 checksum/byteSize、病毒扫描并提取纯文本。
    },
  };
}
```

完整 TypeScript 契约位于
`packages/adapters/src/host-runtime.ts` 和 `packages/core/src/ports.ts`。

## 宿主必须保证

1. `generateObject` 返回 `{ output, metadata }`，其中 output 是已解析对象；
2. 支持 JSON Schema 约束，或在桥接层完成结构化解析和修复；
3. 透传 `traceId/requestId/idempotencyKey`，遵守 `timeoutMs/signal`；
4. 记录宿主模型标识、模型版本、提示词版本、输入/输出 Token、耗时和错误类型；
5. 不把模型凭据返回给 AGT-RSN-004；
6. 不在失败时返回演示稿、缓存样例或虚构内容；
7. 图片能力不存在时不实现 `generateImage`，由内容服务明确报告能力不可用。
8. 生产环境实现 `healthCheck`，并为附件实现隔离上传、病毒扫描和文本提取；
9. 附件扫描结果必须返回实际 checksum/byteSize、扫描引擎/特征库版本和纯文本；
10. 图片返回值只允许 PNG/JPEG/WebP；服务会再次解码、限制像素并重编码去元数据。

## Codex 与 JovaAI

- Codex 测试：需要 Codex 部署层提供 `HostRuntimeExecutor`。当前聊天会话不能被本地
  Node 服务自动递归调用；没有桥接只能做人工协作测试和契约测试。
- JovaAI 投产：JovaAI 在 Agent 装载时注入自身执行器。AGT-RSN-004 不关心 JovaAI
  后面选择哪个基础模型。

## 上线前契约测试

- schema 合规率 100%；
- 超时、取消、重试与重复请求不生成重复版本；
- 未知 Claim 被模型引用时 fail-closed；
- 宿主不可用时 Run 和当前 Step 均进入 `FAILED`；
- 不同宿主对同一黄金样本均通过内容治理门；
- 模型或提示词版本变化会触发黄金样本回归。
