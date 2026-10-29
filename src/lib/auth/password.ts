import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * scrypt password hashing (OWASP-recommended parameters: N=2^17, r=8, p=1).
 * Format: scrypt$N$r$p$saltB64$hashB64 — parameters are stored so they can be raised later.
 */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Server-side password policy. Length matters most; we also block trivially weak choices. */
export function passwordProblems(password: string, email?: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  if (/^(.)\1+$/.test(password)) return "Password cannot be a single repeated character.";
  const lowered = password.toLowerCase();
  if (["password12", "1234567890", "qwertyuiop", "nexalpha123", "solme123"].some((w) => lowered.includes(w)))
    return "Password is too common.";
  if (email && lowered.includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4)
    return "Password should not contain your email name.";
  return null;
}

/** A pre-computed hash used to equalize timing when the account does not exist. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash() {
  dummyHash ??= hashPassword(randomBytes(12).toString("hex"));
  return dummyHash;
}
