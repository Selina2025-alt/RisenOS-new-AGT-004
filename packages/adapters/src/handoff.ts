import type { ContentPackage } from "@risen/content-contracts";
import {
  assertOutboundAllowed,
  containsForbiddenDeliveryFields,
  BoundaryViolationError,
  type HandoffPort,
} from "@risen/content-core";
import {
  signAgentEnvelope,
  verifyAgentEnvelope,
} from "./agent-protocol.js";

export class LocalHandoffPort implements HandoffPort {
  readonly deliveries: Array<{ packageId: string; target: string }> = [];

  async deliver(
    contentPackage: ContentPackage,
    target: string,
  ): Promise<NonNullable<ContentPackage["handoffReceipt"]>> {
    if (containsForbiddenDeliveryFields(contentPackage).length > 0) {
      throw new BoundaryViolationError("Content package contains platform-operation fields");
    }
    this.deliveries.push({ packageId: contentPackage.id, target });
    return {
      receiptId: `receipt_${contentPackage.id}`,
      packageId: contentPackage.id,
      contentHash: contentPackage.contentHash,
      acceptedAt: new Date().toISOString(),
      receiver: target,
    };
  }
}

export interface HttpHandoffOptions {
  baseUrl: string;
  apiKey?: string;
  protocolSecret: string;
  allowedHosts: string[];
  timeoutMs?: number;
  maxAttempts?: number;
}

export class HttpHandoffPort implements HandoffPort {
  constructor(private readonly options: HttpHandoffOptions) {}

  async deliver(
    contentPackage: ContentPackage,
    target: string,
  ): Promise<NonNullable<ContentPackage["handoffReceipt"]>> {
    const forbidden = containsForbiddenDeliveryFields(contentPackage);
    if (forbidden.length > 0) {
      throw new BoundaryViolationError(
        `Content package contains forbidden fields: ${forbidden.join(", ")}`,
      );
    }
    const url = assertOutboundAllowed(
      `${this.options.baseUrl.replace(/\/+$/, "")}/content-packages`,
      this.options.allowedHosts,
    );
    const maxAttempts = this.options.maxAttempts ?? 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const envelope = {
        protocolVersion: "1.0" as const,
        messageId: `handoff_${contentPackage.id}`,
        messageType: "CONTENT_PACKAGE" as const,
        sender: "AGT-RSN-004" as const,
        recipient: "AGT-RSN-005" as const,
        organizationId: contentPackage.organizationId,
        traceId: contentPackage.traceId,
        idempotencyKey: contentPackage.id,
        sentAt: new Date().toISOString(),
        payload: { contentPackage, target },
      };
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("Content handoff timed out")),
        this.options.timeoutMs ?? 15_000,
      );
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            ...(this.options.apiKey
              ? { authorization: `Bearer ${this.options.apiKey}` }
              : {}),
            "content-type": "application/json",
            "x-risen-signature": signAgentEnvelope(
              envelope,
              this.options.protocolSecret,
            ),
            "x-risen-message-id": envelope.messageId,
            "x-idempotency-key": envelope.idempotencyKey,
            "x-trace-id": envelope.traceId,
          },
          body: JSON.stringify(envelope),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          const error = new Error(
            `Content handoff failed with ${response.status}: ${detail}`,
          );
          if (
            response.status < 500 &&
            response.status !== 408 &&
            response.status !== 429
          ) {
            throw Object.assign(error, { nonRetryable: true });
          }
          throw error;
        }
        const responseSignature = response.headers.get("x-risen-signature");
        if (!responseSignature) {
          throw new Error("Downstream returned an unsigned HandoffReceipt");
        }
        const responseEnvelope = verifyAgentEnvelope(
          await response.json(),
          responseSignature,
          this.options.protocolSecret,
        );
        if (
          responseEnvelope.messageType !== "HANDOFF_RECEIPT" ||
          responseEnvelope.sender !== "AGT-RSN-005" ||
          responseEnvelope.recipient !== "AGT-RSN-004" ||
          responseEnvelope.organizationId !== contentPackage.organizationId
        ) {
          throw new Error("Downstream returned a mismatched HandoffReceipt envelope");
        }
        const receipt = responseEnvelope.payload.receipt as NonNullable<
          ContentPackage["handoffReceipt"]
        >;
        if (
          !receipt.receiptId ||
          receipt.packageId !== contentPackage.id ||
          receipt.contentHash !== contentPackage.contentHash ||
          !receipt.acceptedAt ||
          !receipt.receiver
        ) {
          throw new Error("Downstream returned an invalid or mismatched HandoffReceipt");
        }
        return receipt;
      } catch (error) {
        lastError = error;
        if (
          (error as { nonRetryable?: boolean }).nonRetryable ||
          attempt === maxAttempts
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Content handoff failed");
  }
}
