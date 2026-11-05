/**
 * Pure text redaction: API keys, bearer tokens, JWTs, session ids, e-mail addresses, IPs and password-like pairs are replaced by
 * placeholders. A leaf module with no imports on purpose: the logger, the provider HTTP layer and the privacy middleware all use it,
 * and keeping it free of dependencies is what keeps them from importing each other (see scripts/check-architecture.mjs).
 */
const REDACTIONS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/\bsess_[0-9]+_[a-f0-9]{16,}\b/gi, "[session]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[api-key]"],
  [/\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}\b/g, "[api-key]"],
  [/\bgsk_[A-Za-z0-9]{16,}\b/g, "[api-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[api-key]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt]"],
  [/(["']?(?:password|passwd|secret|api[_-]?key|token)["']?\s*[:=]\s*)(["'])[^"']*\2/gi, "$1$2[redacted]$2"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
];

export function redact(input: string): string {
  let out = input;
  for (const [re, sub] of REDACTIONS) out = out.replace(re, sub);
  return out;
}
