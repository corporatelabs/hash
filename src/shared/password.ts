const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

const COMMON = new Set([
  "password",
  "123456",
  "12345678",
  "123456789",
  "qwerty",
  "letmein",
  "admin",
  "welcome",
  "iloveyou",
  "abc123",
  "passw0rd",
  "secret",
  "changeme",
  "hash",
]);

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too weak" | "Weak" | "Okay" | "Strong" | "Very strong";
}

const LABELS = ["Too weak", "Weak", "Okay", "Strong", "Very strong"] as const;

/** About 116 bits. Rejection sampling keeps the alphabet uniform. */
export function generatePassword(groups = 5, groupLength = 4): string {
  const needed = groups * groupLength;
  const chars: string[] = [];
  const max = 256 - (256 % ALPHABET.length);
  while (chars.length < needed) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= max) continue;
      const char = ALPHABET[byte % ALPHABET.length];
      if (char === undefined) continue;
      chars.push(char);
      if (chars.length === needed) break;
    }
  }
  const parts: string[] = [];
  for (let i = 0; i < groups; i += 1) {
    parts.push(chars.slice(i * groupLength, (i + 1) * groupLength).join(""));
  }
  return parts.join("-");
}

export function passwordStrength(password: string): PasswordStrength {
  const value = password.normalize("NFC");
  if (value.length < 8 || COMMON.has(value.toLowerCase())) {
    return { score: 0, label: "Too weak" };
  }
  let score = 0;
  if (value.length >= 10) score += 1;
  if (value.length >= 14) score += 1;
  if (value.length >= 18) score += 1;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (classes >= 3) score += 1;
  if (/(.)\1{2,}/.test(value)) score -= 1;
  if (/(?:0123|1234|2345|abcd|qwer|password)/i.test(value)) score -= 1;
  const clamped = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  return { score: clamped, label: LABELS[clamped] };
}

export function passwordAlphabet(): string {
  return ALPHABET;
}
