import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { FIREBASE_API_KEY, FIREBASE_PROJECT_ID } from "./config.js";

/**
 * Google's public keys for Firebase ID tokens. `jose` fetches and caches these,
 * refetching on an unknown `kid`, which is what lets us verify ID tokens
 * without the firebase-admin SDK or a service-account private key.
 *
 * goava-mcp needs FIREBASE_SERVICE_ACCOUNT_B64 because firebase-admin requires
 * it; verifying against the public JWKS needs only the project id.
 */
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export interface FirebaseIdentity {
  /** Firebase UID — a string, not the numeric Goava user id. */
  uid: string;
  /** Goava's numeric user id, carried as a custom claim. */
  goavaUserId: string;
  /** Goava account id. In Firebase claims this is `client_id`, not `account_id`. */
  accountId: string;
  email: string;
  name: string;
  language: string;
  userMarkets: string;
  /** Unix seconds at which the ID token expires. */
  expiresAt: number;
}

/**
 * Verify a Firebase ID token's signature, issuer, audience and expiry.
 * Throws on any failure — callers must treat that as a 401.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseIdentity> {
  if (!FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID is not set — cannot verify Firebase ID tokens");
  }

  const { payload } = await jwtVerify(idToken, JWKS, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });

  const uid = str(payload.sub);
  if (!uid) throw new Error("Firebase ID token has no subject");

  return {
    uid,
    // Prefer the numeric Goava id from the custom claim — the DB schema expects
    // a number, and the Firebase UID is an opaque string.
    goavaUserId: str(payload.goava_user_id) || uid,
    // Firebase's `client_id` custom claim is the Goava account id.
    accountId: str(payload.client_id) || str(payload.account_id),
    email: str(payload.email),
    name: str(payload.name),
    language: str(payload.language),
    userMarkets: str(payload.user_markets),
    expiresAt: typeof payload.exp === "number" ? payload.exp : 0,
  };
}

/** Unix-seconds expiry of an ID token, read without verifying. */
export function readIdTokenExpiry(idToken: string): number {
  try {
    const payload = decodeJwt(idToken);
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

export interface RefreshedIdToken {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

/**
 * Exchange a Firebase refresh token for a fresh ID token.
 *
 * Firebase ID tokens last 1 hour but our bearer tokens last 8, so without this
 * a session would stop being able to reach the Goava API partway through.
 * Requires FIREBASE_API_KEY (the public Web API key, safe to ship).
 */
export async function refreshFirebaseIdToken(refreshToken: string): Promise<RefreshedIdToken> {
  if (!FIREBASE_API_KEY) {
    throw new Error("FIREBASE_API_KEY is not set — cannot refresh an expired Firebase ID token");
  }

  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Firebase token refresh failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { id_token?: string; refresh_token?: string; expires_in?: string };
  if (!json.id_token) throw new Error("Firebase token refresh returned no id_token");

  const expiresIn = Number(json.expires_in ?? 3600);
  return {
    idToken: json.id_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (Number.isFinite(expiresIn) ? expiresIn : 3600),
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
