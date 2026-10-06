import { SignJWT, jwtVerify } from "jose";
import { BEARER_TOKEN_TTL_SECONDS, JWT_SECRET } from "./config.js";
import type { UserClaims } from "./store.js";

const secret = new TextEncoder().encode(JWT_SECRET);

export interface BearerClaims extends UserClaims {
  clientId: string;
  /** Session holding the Goava API credentials for this user. */
  sessionId: string;
}

/**
 * Issue the bearer token an MCP client sends back on every /mcp request.
 * Claim names match goava-mcp's issue_bearer_token so tokens stay
 * interchangeable between the two servers.
 */
export async function issueBearerToken(claims: BearerClaims): Promise<string> {
  return new SignJWT({
    user_id: claims.userId,
    client_id: claims.clientId,
    account_id: claims.accountId,
    email: claims.email,
    name: claims.name,
    language: claims.language,
    user_markets: claims.userMarkets,
    sid: claims.sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${BEARER_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

/** Throws if the token is malformed, unsigned by us, or expired. */
export async function verifyBearerToken(token: string): Promise<BearerClaims> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });

  // goava-mcp accepts tokens from several deployment generations; keep the
  // same fallback chain so its tokens work here too.
  const userId = str(payload.user_id) || str(payload.goava_user_id) || str(payload.sub);

  return {
    userId,
    accountId: str(payload.account_id),
    email: str(payload.email),
    name: str(payload.name),
    language: str(payload.language),
    userMarkets: str(payload.user_markets),
    clientId: str(payload.client_id),
    sessionId: str(payload.sid),
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
