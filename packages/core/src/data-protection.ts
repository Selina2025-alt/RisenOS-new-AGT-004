import { sha256 } from "./utils.js";

export interface SensitiveDataFinding {
  category:
    | "SECRET"
    | "EMAIL"
    | "PHONE"
    | "NATIONAL_ID"
    | "BANK_CARD"
    | "PROMPT_INJECTION";
  path: string;
  valueHash: string;
  action: "BLOCK" | "REDACT";
}

const rules: Array<{
  category: SensitiveDataFinding["category"];
  action: SensitiveDataFinding["action"];
  expression: RegExp;
}> = [
  {
    category: "PROMPT_INJECTION",
    action: "BLOCK",
    expression:
      /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)\s+(?:instructions?|messages?)|(?:reveal|print|return)\s+(?:the\s+)?(?:system|developer)\s+prompt|<\|(?:system|assistant|developer)\|>/gi,
  },
  {
    category: "SECRET",
    action: "BLOCK",
    expression:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{12,}/gi,
  },
  {
    category: "EMAIL",
    action: "REDACT",
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    category: "NATIONAL_ID",
    action: "REDACT",
    expression: /\b\d{17}[\dXx]\b/g,
  },
  {
    category: "PHONE",
    action: "REDACT",
    expression: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g,
  },
  {
    category: "BANK_CARD",
    action: "REDACT",
    expression: /\b(?:\d[ -]?){15,18}\d\b/g,
  },
];

export function protectSensitiveData<T>(value: T): {
  sanitized: T;
  findings: SensitiveDataFinding[];
  blocked: boolean;
} {
  const findings: SensitiveDataFinding[] = [];

  const visit = (item: unknown, path: string): unknown => {
    if (typeof item === "string") {
      let sanitized = item;
      for (const rule of rules) {
        rule.expression.lastIndex = 0;
        sanitized = sanitized.replace(rule.expression, (match) => {
          findings.push({
            category: rule.category,
            path,
            valueHash: sha256(match),
            action: rule.action,
          });
          return `[REDACTED_${rule.category}]`;
        });
      }
      return sanitized;
    }
    if (Array.isArray(item)) {
      return item.map((entry, index) => visit(entry, `${path}[${index}]`));
    }
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>).map(([key, entry]) => [
          key,
          visit(entry, path ? `${path}.${key}` : key),
        ]),
      );
    }
    return item;
  };

  return {
    sanitized: visit(value, "") as T,
    findings,
    blocked: findings.some((finding) => finding.action === "BLOCK"),
  };
}
