import { createHash, timingSafeEqual } from "node:crypto";

/**
 * RFC 7636 S256 verification: base64url(sha256(code_verifier)) must equal the
 * code_challenge recorded at /authorize time.
 *
 * Compared in constant time — a plain `===` on a secret-derived value leaks
 * timing information.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;

  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);

  // timingSafeEqual throws on length mismatch, so guard first. The length of a
  // base64url SHA-256 digest is fixed and public, so this leaks nothing.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
