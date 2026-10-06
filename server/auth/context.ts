import { AsyncLocalStorage } from "node:async_hooks";
import { BEARER_TOKEN_TTL_SECONDS } from "./config.js";
import { refreshFirebaseIdToken } from "./firebase.js";
import { store, type Session } from "./store.js";

/**
 * Request-scoped session, the equivalent of goava-mcp's `_user_ctx` ContextVar
 * (auth_context.py).
 *
 * AsyncLocalStorage — not a module-level variable. server/index.ts builds a
 * fresh McpServer per HTTP request and requests interleave, so a shared mutable
 * would hand one user's token to another user's tool call.
 */
const sessionStorage = new AsyncLocalStorage<Session>();

/** Run `fn` with `session` visible to everything it awaits. */
export function runWithSession<T>(session: Session, fn: () => T): T {
  return sessionStorage.run(session, fn);
}

/** The current request's session, or undefined in stdio mode / unauthenticated calls. */
export function currentSession(): Session | undefined {
  return sessionStorage.getStore();
}

/** The authenticated user's claims, for tools that need user_id / account_id. */
export function currentUser(): Session | undefined {
  return sessionStorage.getStore();
}

/** Refresh this many seconds before actual expiry, so a call in flight can't race it. */
const REFRESH_SKEW_SECONDS = 120;

/**
 * The token to send as the Goava GraphQL `authorization` header for the current
 * request, or null when there is no session.
 *
 * Transparently refreshes an expiring Firebase ID token. Returns the stale
 * token rather than throwing if the refresh fails, so the caller surfaces the
 * API's own 401 instead of an opaque auth error.
 */
export async function currentGoavaToken(): Promise<string | null> {
  const session = sessionStorage.getStore();
  if (!session) return null;

  // Direct (dev) mode creates a session with no Firebase token at all. Return
  // null rather than an empty string so the caller's `?? GOAVA_API_TOKEN`
  // fallback actually engages — `??` does not treat "" as absent.
  if (!session.idToken) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.idTokenExpiresAt > now + REFRESH_SKEW_SECONDS) {
    return session.idToken;
  }

  if (!session.refreshToken) {
    console.error(
      `Goava session for user_id=${session.userId} has an expired ID token and no refresh token; ` +
        "the user must re-authorize.",
    );
    return session.idToken;
  }

  try {
    const refreshed = await refreshFirebaseIdToken(session.refreshToken);
    // Mutate in place so concurrent calls sharing this session object see the
    // new token, then persist it for later requests.
    session.idToken = refreshed.idToken;
    session.refreshToken = refreshed.refreshToken;
    session.idTokenExpiresAt = refreshed.expiresAt;
    await store.saveSession(session, BEARER_TOKEN_TTL_SECONDS);
    return refreshed.idToken;
  } catch (err) {
    console.error(`Failed to refresh Firebase ID token: ${err instanceof Error ? err.message : String(err)}`);
    return session.idToken;
  }
}
