import type { ContentVersion, ReviewRequest } from "@risen/content-contracts";
import { assertOutboundAllowed, type ReviewPort } from "@risen/content-core";

export class LocalReviewPort implements ReviewPort {
  async submit(review: ReviewRequest, _content: ContentVersion): Promise<void> {
    if (review.reviewerType === "AGT-RSN-006") {
      throw new Error(
        "AGT-RSN-006 review was requested but no external ReviewPort is configured",
      );
    }
    // Review state is persisted by the application. This local adapter deliberately
    // performs no external action for the built-in human review desk.
  }
}

export class HttpReviewPort implements ReviewPort {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      allowedHosts: string[];
    },
  ) {}

  async submit(review: ReviewRequest, content: ContentVersion): Promise<void> {
    const url = assertOutboundAllowed(
      `${this.options.baseUrl.replace(/\/+$/, "")}/review-requests`,
      this.options.allowedHosts,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
        "x-idempotency-key": review.id,
        "x-trace-id": review.traceId,
      },
      body: JSON.stringify({
        protocolVersion: "1.0",
        idempotencyKey: review.id,
        review,
        content,
      }),
    });
    if (!response.ok) {
      throw new Error(`AGT-RSN-006 review submission failed with ${response.status}`);
    }
  }
}
