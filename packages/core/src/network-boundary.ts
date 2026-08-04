import { BoundaryViolationError } from "./errors.js";

const forbiddenPlatformHosts = [
  "api.weixin.qq.com",
  "mp.weixin.qq.com",
  "weixin.qq.com",
  "xiaohongshu.com",
  "xhslink.com",
  "api.x.com",
  "twitter.com",
  "api.twitter.com",
  "tiktok.com",
  "douyin.com",
];

export function assertOutboundAllowed(
  rawUrl: string,
  allowedHosts: readonly string[],
): URL {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();

  if (
    forbiddenPlatformHosts.some(
      (forbidden) => host === forbidden || host.endsWith(`.${forbidden}`),
    )
  ) {
    throw new BoundaryViolationError(
      `AGT-RSN-004 cannot connect to content platform host: ${host}`,
    );
  }

  if (!allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new BoundaryViolationError(`Outbound host is not allowlisted: ${host}`);
  }

  return url;
}

export function containsForbiddenDeliveryFields(value: unknown): string[] {
  const forbidden = new Set([
    "accountId",
    "accountRef",
    "accessToken",
    "cookie",
    "publishAt",
    "scheduledAt",
    "publishStatus",
    "platformContentId",
    "platformUrl",
    "impressions",
    "engagement",
    "conversions",
  ]);
  const matches: string[] = [];

  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (current && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        const childPath = path ? `${path}.${key}` : key;
        if (forbidden.has(key)) {
          matches.push(childPath);
        }
        visit(child, childPath);
      }
    }
  };

  visit(value, "");
  return matches;
}
