import { AsyncLocalStorage } from "node:async_hooks";
import { REFRESH_SKEW_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from "./config.js";
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

/**
 * Bring a session's Goava credential up to date, renewing it if it is within
 * REFRESH_SKEW_SECONDS of expiry. Returns false when the credential has expired
 * and cannot be renewed — the caller must then force re-authorization rather
 * than let a dead token reach the API.
 *
 * Renewal is lazy (on use) rather than on a fixed timer: it costs nothing while
 * the session is idle, survives an idle period longer than the token lifetime,
 * and cannot drift out of step with the actual expiry.
 *
 * Concurrent callers share the in-flight refresh via `pending`, so N parallel
 * tool calls on one session trigger one network round-trip, not N.
 */
const pending = new Map<string, Promise<boolean>>();

export async function refreshIfNeeded(session: Session): Promise<boolean> {
  // Direct (dev) mode sessions carry no Firebase credential; nothing to renew.
  if (!session.idToken) return true;

  const now = Math.floor(Date.now() / 1000);
  if (session.idTokenExpiresAt > now + REFRESH_SKEW_SECONDS) return true;

  const inFlight = pending.get(session.sessionId);
  if (inFlight) return inFlight;

  const task = (async () => {
    if (!session.refreshToken) {
      console.error(
        `Goava session user_id=${session.userId} has an expired Firebase ID token and no refresh ` +
          "token, so it cannot be renewed. The login page must send `firebase_refresh_token` for " +
          "sessions to outlive the token's 1-hour lifetime.",
      );
      return false;
    }
    try {
      const refreshed = await refreshFirebaseIdToken(session.refreshToken);
      // Mutate in place so concurrent callers holding this object see the new
      // token, then persist for later requests. Keep the session's original
      // TTL — re-saving with a shorter one would quietly cap session lifetime.
      session.idToken = refreshed.idToken;
      session.refreshToken = refreshed.refreshToken;
      session.idTokenExpiresAt = refreshed.expiresAt;
      await store.saveSession(session, REFRESH_TOKEN_TTL_SECONDS);
      console.error(`Renewed Firebase ID token for user_id=${session.userId}`);
      return true;
    } catch (err) {
      console.error(`Failed to renew Firebase ID token: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  })().finally(() => pending.delete(session.sessionId));

  pending.set(session.sessionId, task);
  return task;
}

/**
 * The token to send as the Goava GraphQL `authorization` header for the current
 * request, or null when there is no session (stdio mode, direct mode), in which
 * case the caller falls back to GOAVA_API_TOKEN.
 */
export async function currentGoavaToken(): Promise<string | null> {
  const session = sessionStorage.getStore();
  if (!session) return null;

  // Returns null, never "", so the caller's `?? GOAVA_API_TOKEN` fallback
  // engages — `??` does not treat "" as absent.
  if (!session.idToken) return null;

  await refreshIfNeeded(session);
  return session.idToken;
}
