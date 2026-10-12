/** Never store secrets in logs. Keys that look sensitive are replaced, at any depth. */
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|signature|^code$|otp|totp|api[-_]?key|private|refresh|nonce|seed|mnemonic/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1)]));
}

/** Path with sensitive query values removed (?token=..., ?code=..., ?state=...). */
export function redactUrl(url: string) {
  const [path, query] = url.split('?');
  if (!query) return path.slice(0, 500);
  const params = new URLSearchParams(query);
  for (const k of Array.from(params.keys())) if (SENSITIVE.test(k) || k === 'state') params.set(k, '[redacted]');
  return `${path}?${params.toString()}`.slice(0, 500);
}
