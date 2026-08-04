import {
  AgentMessageEnvelopeSchema,
  type AgentMessageEnvelope,
  type OutboxMessage,
} from "@risen/content-contracts";
import {
  assertOutboundAllowed,
  type ContentRepository,
} from "@risen/content-core";
import { createHmac, timingSafeEqual } from "node:crypto";
import { metrics } from "@opentelemetry/api";

export type AgentRecipient = OutboxMessage["recipient"];

export interface AgentProtocolDispatcherOptions {
  secret: string;
  routes: Partial<Record<AgentRecipient, string>>;
  allowedHosts: string[];
  timeoutMs?: number;
  maxAttempts?: number;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function signAgentEnvelope(
  envelope: AgentMessageEnvelope,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalJson(envelope))
    .digest("hex");
}

export function verifyAgentEnvelope(
  rawEnvelope: unknown,
  signature: string,
  secret: string,
  options: { now?: number; maximumClockSkewMs?: number } = {},
): AgentMessageEnvelope {
  const envelope = AgentMessageEnvelopeSchema.parse(rawEnvelope);
  const sentAt = Date.parse(envelope.sentAt);
  const now = options.now ?? Date.now();
  const maximumClockSkewMs = options.maximumClockSkewMs ?? 5 * 60_000;
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > maximumClockSkewMs) {
    throw new Error("Agent message timestamp is outside the accepted window");
  }
  const expected = Buffer.from(signAgentEnvelope(envelope, secret), "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Agent message signature is invalid");
  }
  return envelope;
}

export class AgentProtocolDispatcher {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly deliveries = metrics
    .getMeter("agt-rsn-004-agent-protocol")
    .createCounter("agt004.agent_protocol.deliveries");

  constructor(
    private readonly repository: ContentRepository,
    private readonly options: AgentProtocolDispatcherOptions,
  ) {
    if (options.secret.length < 32) {
      throw new Error("Agent protocol secret must contain at least 32 characters");
    }
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 12;
  }

  async dispatchBatch(limit = 20): Promise<{
    claimed: number;
    sent: number;
    failed: number;
    dead: number;
  }> {
    const messages = await this.repository.claimOutboxMessages(limit);
    const results = await Promise.all(
      messages.map(async (message) => this.dispatchOne(message)),
    );
    return {
      claimed: messages.length,
      sent: results.filter((item) => item === "SENT").length,
      failed: results.filter((item) => item === "FAILED").length,
      dead: results.filter((item) => item === "DEAD").length,
    };
  }

  private async dispatchOne(
    message: OutboxMessage,
  ): Promise<"SENT" | "FAILED" | "DEAD"> {
    const endpoint = this.options.routes[message.recipient];
    const attempt = message.attempts + 1;
    if (!endpoint) {
      return this.recordFailure(message, attempt, "Recipient route is not configured");
    }

    const envelope: AgentMessageEnvelope = AgentMessageEnvelopeSchema.parse({
      protocolVersion: message.protocolVersion,
      messageId: message.id,
      messageType: message.messageType,
      sender: message.sender,
      recipient: message.recipient,
      organizationId: message.organizationId,
      traceId: message.traceId,
      idempotencyKey: message.idempotencyKey,
      sentAt: new Date().toISOString(),
      payload: message.payload,
    });
    const url = assertOutboundAllowed(endpoint, this.options.allowedHosts);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-risen-signature": signAgentEnvelope(envelope, this.options.secret),
          "x-risen-message-id": envelope.messageId,
          "x-idempotency-key": envelope.idempotencyKey,
          "x-trace-id": envelope.traceId,
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      if (!response.ok) {
        return this.recordFailure(
          message,
          attempt,
          `Recipient returned HTTP ${response.status}`,
        );
      }
      const timestamp = new Date().toISOString();
      await this.repository.saveOutboxMessage({
        ...message,
        status: "SENT",
        attempts: attempt,
        sentAt: timestamp,
        updatedAt: timestamp,
        lastError: undefined,
      });
      this.deliveries.add(1, {
        recipient: message.recipient,
        messageType: message.messageType,
        outcome: "sent",
      });
      return "SENT";
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? "Recipient request timed out"
          : error instanceof Error
            ? error.message.slice(0, 500)
            : "Recipient request failed";
      return this.recordFailure(message, attempt, reason);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async recordFailure(
    message: OutboxMessage,
    attempts: number,
    reason: string,
  ): Promise<"FAILED" | "DEAD"> {
    const dead = attempts >= this.maxAttempts;
    const timestamp = new Date().toISOString();
    const delayMs = Math.min(15 * 60_000, 2_000 * 2 ** Math.min(attempts - 1, 8));
    await this.repository.saveOutboxMessage({
      ...message,
      status: dead ? "DEAD" : "FAILED",
      attempts,
      updatedAt: timestamp,
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      lastError: reason.slice(0, 500),
    });
    this.deliveries.add(1, {
      recipient: message.recipient,
      messageType: message.messageType,
      outcome: dead ? "dead" : "retry",
    });
    return dead ? "DEAD" : "FAILED";
  }
}
