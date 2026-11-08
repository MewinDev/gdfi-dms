/**
 * Finds strings that look like a secret in text. Reports the kind and the line number only: never the
 * matched text. Used by the repo scan test (lib/env/secret-scan.test.ts) and the one-off sweep.
 */
export interface SecretHit { kind: string; line: number }

/** Values that are obviously placeholders or test fakes. */
const PLACEHOLDER = /change-me|replace|example|placeholder|your[-_]|<[^>]*>|\$\{|x{4,}|\*{3,}|dummy|fake|sample|not-a-real|test|secret|sekret|redacted/i;

const PATTERNS: { kind: string; re: RegExp; value?: number }[] = [
  { kind: "Microsoft client secret", re: /(?<![A-Za-z0-9_~.-])[A-Za-z0-9_~.-]{3}\dQ~[A-Za-z0-9_~.-]{31,34}(?![A-Za-z0-9_~.-])/g },
  { kind: "private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { kind: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { kind: "connection string with a password", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@"'`]+:([^@\s"'`]+)@/g, value: 1 },
  { kind: "bearer token", re: /\bBearer\s+([A-Za-z0-9._~+/-]{24,}=*)/g, value: 1 },
  {
    kind: "secret assignment",
    re: /\b[A-Za-z0-9_]*(?:SECRET|API_?KEY|TOKEN|PASSWORD|PASSWD|CLIENT_SECRET)\b["']?\s*[:=]\s*["'`]?([A-Za-z0-9+/_~.-]{16,})/gi,
    value: 1,
  },
];

export function findSecrets(text: string, known: string[] = []): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const p of PATTERNS) {
      for (const m of line.matchAll(p.re)) {
        const value = p.value ? m[p.value] : m[0];
        if (PLACEHOLDER.test(value)) continue;
        if (p.kind === "connection string with a password" && /^(password|pass|pw|p|secret|postgres)$/i.test(value)) continue;
        if (p.kind === "secret assignment" && /^(process\.env|env\.|[A-Z_]+$)/.test(value)) continue; // a reference, not a value
        hits.push({ kind: p.kind, line: i + 1 });
      }
    }
    for (const k of known) if (k.length >= 8 && line.includes(k)) hits.push({ kind: "a value from this PC's env files", line: i + 1 });
  });
  return hits;
}

/** Values in the env files whose names say they are secret (to make sure none is copied anywhere). */
export function knownSecretValues(vars: Record<string, string>): string[] {
  return Object.entries(vars)
    .filter(([name, v]) => /SECRET|API_KEY|TOKEN|PASSWORD|^DATABASE_URL$|^DIRECT_URL$|CLIENT_ID|TENANT_ID|^MYLOANS_(API_)?BASE_URL$/i.test(name) && v.trim().length >= 8)
    .map(([, v]) => v.trim().replace(/^["']|["']$/g, ""));
}
