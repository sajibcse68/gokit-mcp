/**
 * OAuth configuration. Env var names are kept identical to goava-mcp's
 * server_v2.py so an existing deployment config transfers unchanged.
 */

/** Public URL of this MCP server — used in OAuth metadata and redirect URIs. */
export const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "http://localhost:3001";

/**
 * Where /authorize sends the browser to log in.
 * Defaults to this server's own built-in page so local development works with
 * no frontend; point it at the real login page in production.
 */
export const FRONTEND_LOGIN_URL = process.env.FRONTEND_LOGIN_URL ?? `${MCP_SERVER_URL}/test-login`;

/** Origins allowed to POST to /oauth/callback. */
export const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ??
  "https://discover.goava.com,https://staging-discover.goava.com,https://dev-discover.goava.com,https://claude.ai"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** HS256 secret for signing our own bearer tokens. */
export const JWT_SECRET = process.env.JWT_SECRET ?? "change-me-in-production";

/** When set, /test-login must submit this password before a code is issued. */
export const TEST_LOGIN_PASSWORD = process.env.TEST_LOGIN_PASSWORD ?? "";

/**
 * Firebase project that issues the ID tokens. When set, /oauth/callback
 * requires and cryptographically verifies a `firebase_id_token`. When unset,
 * the server runs in direct mode and trusts the posted user_id — dev only.
 */
export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "";

/**
 * Firebase Web API key. Only needed to exchange a Firebase refresh token for a
 * fresh ID token once the original expires (Firebase ID tokens last 1 hour,
 * our bearer tokens last 8). Without it a session simply stops being able to
 * reach the Goava API after an hour and the user must re-authorize.
 */
export const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY ?? "";

/** Firebase auth domain, e.g. `goava-ping.firebaseapp.com`. Used by the built-in login page. */
export const FIREBASE_AUTH_DOMAIN = process.env.FIREBASE_AUTH_DOMAIN ?? "";

export const AUTH_CODE_TTL_SECONDS = 300; // 5 minutes
export const BEARER_TOKEN_TTL_SECONDS = 8 * 3600; // 8 hours
export const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 3600; // 90 days

/**
 * Renew the Firebase ID token once it is within this many seconds of expiring.
 * Firebase ID tokens live 1 hour, so the default renews at roughly the 50-minute
 * mark on first use after that point. Raising it renews earlier and more often.
 */
export const REFRESH_SKEW_SECONDS = Number(process.env.FIREBASE_REFRESH_SKEW_SECONDS ?? 600);

/** True when Firebase ID tokens are verified; false means direct (dev) mode. */
export const isFirebaseMode = (): boolean => Boolean(FIREBASE_PROJECT_ID);

/**
 * Escape hatch for local development: skips the bearer check on /mcp so tools
 * can be exercised with plain curl, falling back to GOAVA_API_TOKEN for API
 * calls. Auth is on by default — this must be set deliberately.
 */
export const AUTH_DISABLED = /^(1|true|yes)$/i.test(process.env.MCP_AUTH_DISABLED ?? "");

/** Paths that skip the bearer check. Mirrors _PUBLIC_PATHS in server_v2.py. */
export const PUBLIC_PATHS = new Set([
  "/health",
  "/favicon.ico",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/callback",
  "/oauth/token",
  // Short-path aliases — claude.ai's backend uses these during token exchange.
  "/register",
  "/authorize",
  "/token",
  "/test-login",
]);
