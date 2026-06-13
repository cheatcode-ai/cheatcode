const SECRET_PATTERNS: RegExp[] = [
  /(sk-ant-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/g,
  /(AIza[A-Za-z0-9_-]{30,})/g,
  /(exa_[A-Za-z0-9_-]{20,}|fc-[A-Za-z0-9_-]{20,}|fal_[A-Za-z0-9_-]{20,}|llx-[A-Za-z0-9_-]{20,})/g,
  /(xi-[A-Za-z0-9_-]{20,}|sk_[A-Za-z0-9_-]{20,})/g,
  /(polar_[A-Za-z0-9_-]{20,}|hyper_[A-Za-z0-9_-]{20,})/g,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
];
const QUERY_SECRET_PATTERN =
  /([?&](?:[^=&]*token|password|access|auth|secret|key|sig|signature)=)[^&\s"']+/gi;

function redactString(value: string): string {
  const valueRedacted = value.replace(QUERY_SECRET_PATTERN, "$1[REDACTED]");
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[REDACTED]"),
    valueRedacted,
  );
}

export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return redactString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/password|token|auth|secret|key|sig/i.test(key)) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactSecrets(item);
      }
    }
    return redacted as T;
  }

  return value;
}
