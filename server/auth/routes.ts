import { randomUUID, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ALLOWED_ORIGINS,
  AUTH_CODE_TTL_SECONDS,
  BEARER_TOKEN_TTL_SECONDS,
  FRONTEND_LOGIN_URL,
  MCP_SERVER_URL,
  REFRESH_TOKEN_TTL_SECONDS,
  TEST_LOGIN_PASSWORD,
  isFirebaseMode,
} from "./config.js";
import { readIdTokenExpiry, verifyFirebaseIdToken } from "./firebase.js";
import { verifyPkceS256 } from "./pkce.js";
import { store, type AuthCodeRecord, type Session, type UserClaims } from "./store.js";
import { renderTestLoginPage } from "./testLogin.js";
import { issueBearerToken, verifyBearerToken } from "./tokens.js";

/* -------------------------------------------------------------------------- */
/* node:http helpers                                                          */
/* -------------------------------------------------------------------------- */

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" }).end(payload);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(html);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** RFC 6749 requires /token to accept application/x-www-form-urlencoded. */
async function readFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = await readBody(req);
  const contentType = req.headers["content-type"] ?? "";

  // Some MCP clients post JSON here despite the spec; accept both.
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function log(msg: string): void {
  console.error(`[oauth] ${msg}`);
}

/** Never log a whole token or code. */
function head(secret: string): string {
  return secret ? `${secret.slice(0, 8)}…` : "<missing>";
}

/* -------------------------------------------------------------------------- */
/* Route handling                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Handles every OAuth and discovery route. Returns true when the request was
 * served, false when the caller should keep handling it (i.e. it was /mcp).
 */
export async function handleAuthRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", MCP_SERVER_URL);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path === "/health") {
    sendJson(res, 200, { status: "ok" });
    return true;
  }

  // RFC 9728 — points clients at the authorization server protecting /mcp.
  if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
    sendJson(res, 200, { resource: MCP_SERVER_URL, authorization_servers: [MCP_SERVER_URL] });
    return true;
  }

  // RFC 8414 — authorization server metadata.
  if (path === "/.well-known/oauth-authorization-server") {
    sendJson(res, 200, {
      issuer: MCP_SERVER_URL,
      authorization_endpoint: `${MCP_SERVER_URL}/oauth/authorize`,
      token_endpoint: `${MCP_SERVER_URL}/token`,
      registration_endpoint: `${MCP_SERVER_URL}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [],
    });
    return true;
  }

  if (path === "/test-login" && method === "GET") {
    sendHtml(res, 200, renderTestLoginPage());
    return true;
  }

  // Short-path aliases (/register, /authorize, /token) are what claude.ai's
  // backend actually calls; the /oauth/* forms are the documented ones.
  if ((path === "/register" || path === "/oauth/register") && method === "POST") {
    await handleRegister(req, res);
    return true;
  }

  if ((path === "/authorize" || path === "/oauth/authorize") && method === "GET") {
    await handleAuthorize(url, res);
    return true;
  }

  if (path === "/oauth/callback" && method === "POST") {
    await handleCallback(req, res);
    return true;
  }

  if ((path === "/token" || path === "/oauth/token") && method === "POST") {
    await handleToken(req, res);
    return true;
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* /register — dynamic client registration                                    */
/* -------------------------------------------------------------------------- */

async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const clientId = randomUUID().replace(/-/g, "");
  const clientName = str(body.client_name) || "unknown";
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(str) : [];

  await store.saveClient({ clientId, clientName, redirectUris });
  log(`register: client_name=${clientName} client_id=${clientId} redirect_uris=${redirectUris.join(", ")}`);

  sendJson(res, 201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code"],
    response_types: Array.isArray(body.response_types) ? body.response_types : ["code"],
    token_endpoint_auth_method: str(body.token_endpoint_auth_method) || "none",
  });
}

/* -------------------------------------------------------------------------- */
/* /authorize — redirect the browser to the login page                        */
/* -------------------------------------------------------------------------- */

async function handleAuthorize(url: URL, res: ServerResponse): Promise<void> {
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "S256";
  const state = url.searchParams.get("state") ?? "";

  if (!(await store.getClient(clientId))) {
    log(`authorize: REJECTED unknown client_id=${clientId}`);
    sendJson(res, 400, { error: "invalid_client" });
    return;
  }

  // Only S256 is supported — plain defeats the point of PKCE.
  if (codeChallenge && codeChallengeMethod !== "S256") {
    log(`authorize: REJECTED unsupported code_challenge_method=${codeChallengeMethod}`);
    sendJson(res, 400, { error: "invalid_request", error_description: "only S256 is supported" });
    return;
  }

  // mcp_callback tells the login page where to POST the identity it obtains.
  const qs = new URLSearchParams({
    mcp_callback: `${MCP_SERVER_URL}/oauth/callback`,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    state,
  });
  const loginUrl = `${FRONTEND_LOGIN_URL}?${qs}`;
  log(`authorize: client_id=${clientId} → redirecting to ${FRONTEND_LOGIN_URL}`);
  res.writeHead(302, { Location: loginUrl }).end();
}

/* -------------------------------------------------------------------------- */
/* /oauth/callback — the login page reports who signed in                     */
/* -------------------------------------------------------------------------- */

function isOriginAllowed(origin: string): boolean {
  if (!origin) return true; // same-origin form posts send no Origin header
  if (origin === new URL(MCP_SERVER_URL).origin) return true; // our own /test-login
  return ALLOWED_ORIGINS.includes(origin);
}

async function handleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = str(req.headers.origin);
  if (!isOriginAllowed(origin)) {
    log(`callback: REJECTED disallowed origin=${origin}`);
    sendJson(res, 403, { error: "forbidden_origin" });
    return;
  }

  const body = await readJsonBody(req);
  const clientId = str(body.client_id);
  const redirectUri = str(body.redirect_uri);
  const codeChallenge = str(body.code_challenge);
  const state = str(body.state);

  let claims: UserClaims;
  let idToken = "";
  let refreshToken = "";
  let idTokenExpiresAt = 0;

  if (isFirebaseMode()) {
    // ── Firebase mode: verify the ID token and use it as the Goava API credential ──
    idToken = str(body.firebase_id_token);
    refreshToken = str(body.firebase_refresh_token);
    if (!idToken) {
      sendJson(res, 400, { error: "invalid_request", error_description: "firebase_id_token is required" });
      return;
    }

    try {
      const identity = await verifyFirebaseIdToken(idToken);
      claims = {
        userId: identity.goavaUserId,
        accountId: identity.accountId,
        email: identity.email,
        name: identity.name,
        language: identity.language,
        userMarkets: identity.userMarkets,
      };
      idTokenExpiresAt = identity.expiresAt || readIdTokenExpiry(idToken);
      log(`callback: firebase verified uid=${identity.uid} goava_user_id=${identity.goavaUserId} email=${identity.email}`);
    } catch (err) {
      log(`callback: REJECTED firebase verification failed: ${err instanceof Error ? err.message : String(err)}`);
      sendJson(res, 401, { error: "invalid_firebase_token" });
      return;
    }
  } else {
    // ── Direct mode: trust the posted user_id. Dev only — these credentials
    //    cannot authenticate against the Goava API, only against this server. ──
    if (TEST_LOGIN_PASSWORD && str(body.password) !== TEST_LOGIN_PASSWORD) {
      log("callback: REJECTED wrong test-login password");
      sendJson(res, 401, { error: "invalid_password" });
      return;
    }
    const userId = str(body.user_id);
    if (!userId) {
      sendJson(res, 400, { error: "invalid_request", error_description: "user_id is required" });
      return;
    }
    claims = {
      userId,
      accountId: str(body.account_id),
      email: str(body.email),
      name: "",
      language: "",
      userMarkets: "",
    };
    log(`callback: direct mode user_id=${userId} account_id=${claims.accountId}`);
  }

  // Park the Goava credentials in a session; the auth code only carries its id.
  const sessionId = randomUUID();
  const session: Session = { sessionId, ...claims, idToken, refreshToken, idTokenExpiresAt };
  await store.saveSession(session, REFRESH_TOKEN_TTL_SECONDS);

  const code = randomBytes(32).toString("base64url");
  const record: AuthCodeRecord = { ...claims, clientId, codeChallenge, redirectUri, sessionId };
  await store.saveAuthCode(code, record, AUTH_CODE_TTL_SECONDS);
  log(`callback: auth code ${head(code)} issued for user_id=${claims.userId}`);

  const qs = new URLSearchParams({ code, state });
  sendJson(res, 200, { redirect_url: `${redirectUri}?${qs}` });
}

/* -------------------------------------------------------------------------- */
/* /token — exchange a code or refresh token for a bearer token               */
/* -------------------------------------------------------------------------- */

async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readFormBody(req);
  const grantType = body.grant_type ?? "";
  const clientId = body.client_id ?? "";

  if (grantType === "authorization_code") {
    const code = body.code ?? "";
    const codeVerifier = body.code_verifier ?? "";
    const redirectUri = body.redirect_uri ?? "";

    const record = await store.popAuthCode(code);
    if (!record) {
      log(`token: REJECTED auth code ${head(code)} not found or expired`);
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }
    if (record.clientId !== clientId) {
      log(`token: REJECTED client_id mismatch for code ${head(code)}`);
      sendJson(res, 400, { error: "invalid_client" });
      return;
    }
    if (!verifyPkceS256(codeVerifier, record.codeChallenge)) {
      log(`token: REJECTED PKCE verification failed for client_id=${clientId}`);
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }
    if (record.redirectUri !== redirectUri) {
      log(`token: REJECTED redirect_uri mismatch for client_id=${clientId}`);
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }

    await issueTokenPair(res, record, clientId, record.sessionId);
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = body.refresh_token ?? "";
    if (!refreshToken) {
      sendJson(res, 400, { error: "invalid_request" });
      return;
    }

    const record = await store.popRefreshToken(refreshToken);
    if (!record) {
      log(`token: REJECTED refresh token ${head(refreshToken)} not found or expired`);
      sendJson(res, 400, { error: "invalid_grant" });
      return;
    }
    if (record.clientId !== clientId) {
      log("token: REJECTED client_id mismatch on refresh");
      sendJson(res, 400, { error: "invalid_client" });
      return;
    }

    await issueTokenPair(res, record, clientId, record.sessionId);
    return;
  }

  log(`token: REJECTED unsupported grant_type=${grantType}`);
  sendJson(res, 400, { error: "unsupported_grant_type" });
}

/** Issues an access token plus a rotated refresh token. */
async function issueTokenPair(
  res: ServerResponse,
  claims: UserClaims,
  clientId: string,
  sessionId: string,
): Promise<void> {
  const accessToken = await issueBearerToken({ ...claims, clientId, sessionId });
  const refreshToken = randomBytes(32).toString("base64url");
  await store.saveRefreshToken(refreshToken, { ...claims, clientId, sessionId }, REFRESH_TOKEN_TTL_SECONDS);

  log(`token: issued access+refresh for user_id=${claims.userId} account_id=${claims.accountId}`);
  sendJson(res, 200, {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: BEARER_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
  });
}

/* -------------------------------------------------------------------------- */
/* Bearer authentication for /mcp                                             */
/* -------------------------------------------------------------------------- */

function sendUnauthorized(res: ServerResponse, reason: string): void {
  res
    .writeHead(401, {
      "Content-Type": "application/json",
      // RFC 9728: tells the client where to discover how to authenticate,
      // which is what makes claude.ai start the OAuth flow automatically.
      "WWW-Authenticate":
        `Bearer realm="${MCP_SERVER_URL}", ` +
        `resource_metadata="${MCP_SERVER_URL}/.well-known/oauth-protected-resource"`,
    })
    .end(JSON.stringify({ error: "unauthorized", error_description: reason }));
}

/**
 * Verifies the Authorization header and resolves the caller's session.
 * Writes a 401 and returns null when authentication fails.
 */
export async function authenticateRequest(req: IncomingMessage, res: ServerResponse): Promise<Session | null> {
  const auth = str(req.headers.authorization);
  if (!auth.startsWith("Bearer ")) {
    log(`401 no-bearer: ${req.method} ${req.url}`);
    sendUnauthorized(res, "missing bearer token");
    return null;
  }

  let claims;
  try {
    claims = await verifyBearerToken(auth.slice(7));
  } catch (err) {
    log(`401 bad-token: ${err instanceof Error ? err.message : String(err)}`);
    sendUnauthorized(res, "invalid or expired token");
    return null;
  }

  const session = await store.getSession(claims.sessionId);
  if (!session) {
    // Sessions live in memory, so a server restart invalidates them even though
    // the bearer token itself is still cryptographically valid.
    log(`401 no-session: sid=${head(claims.sessionId)} user_id=${claims.userId}`);
    sendUnauthorized(res, "session expired, please re-authorize");
    return null;
  }

  // NOTE: goava-mcp additionally re-validates user_id/account_id/email against
  // prod_infosource.app_account_user over MySQL on every request
  // (tools/_validate.py). That table is not reachable over GraphQL, so this
  // server trusts the signed JWT claims instead. The check is dropped, not
  // forgotten — restore it if a GraphQL equivalent appears.
  return session;
}
