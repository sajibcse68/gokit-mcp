/**
 * OAuth bookkeeping storage.
 *
 * goava-mcp keeps these in three DynamoDB tables. This repo talks to Goava over
 * GraphQL only and has no AWS SDK, so the interface below is deliberately small
 * enough to back with DynamoDB, Redis or Postgres later without touching the
 * route handlers.
 *
 * The bundled implementation is in-memory: state is lost on restart and is not
 * shared between processes. That is fine for a single local server (the user
 * just re-authorizes), but a multi-instance deployment needs a shared store.
 */

export interface UserClaims {
  userId: string;
  accountId: string;
  email: string;
  name: string;
  language: string;
  userMarkets: string;
}

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export interface AuthCodeRecord extends UserClaims {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  /** Session holding this user's Goava API credentials. */
  sessionId: string;
}

export interface RefreshTokenRecord extends UserClaims {
  clientId: string;
  sessionId: string;
}

/**
 * The credentials a tool call needs to reach the Goava GraphQL API on the
 * user's behalf. The webapp sends the raw Firebase ID token as the
 * `authorization` header (see webapp/src/services/api/axios.js), so that is
 * what we store and forward.
 */
export interface Session extends UserClaims {
  sessionId: string;
  idToken: string;
  /** Firebase refresh token, when the login page supplied one. */
  refreshToken: string;
  /** Unix seconds at which idToken expires. */
  idTokenExpiresAt: number;
}

export interface OAuthStore {
  saveClient(client: OAuthClient): Promise<void>;
  getClient(clientId: string): Promise<OAuthClient | null>;

  saveAuthCode(code: string, record: AuthCodeRecord, ttlSeconds: number): Promise<void>;
  /** One-time use: returns the record and deletes it. Null if missing or expired. */
  popAuthCode(code: string): Promise<AuthCodeRecord | null>;

  saveRefreshToken(token: string, record: RefreshTokenRecord, ttlSeconds: number): Promise<void>;
  /** Rotation — one-time use, same semantics as popAuthCode. */
  popRefreshToken(token: string): Promise<RefreshTokenRecord | null>;

  saveSession(session: Session, ttlSeconds: number): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
}

interface Expiring<T> {
  value: T;
  expiresAt: number;
}

const now = (): number => Math.floor(Date.now() / 1000);

export class InMemoryOAuthStore implements OAuthStore {
  private clients = new Map<string, OAuthClient>();
  private codes = new Map<string, Expiring<AuthCodeRecord>>();
  private refreshTokens = new Map<string, Expiring<RefreshTokenRecord>>();
  private sessions = new Map<string, Expiring<Session>>();

  async saveClient(client: OAuthClient): Promise<void> {
    this.clients.set(client.clientId, client);
  }

  async getClient(clientId: string): Promise<OAuthClient | null> {
    return this.clients.get(clientId) ?? null;
  }

  async saveAuthCode(code: string, record: AuthCodeRecord, ttlSeconds: number): Promise<void> {
    this.codes.set(code, { value: record, expiresAt: now() + ttlSeconds });
  }

  async popAuthCode(code: string): Promise<AuthCodeRecord | null> {
    return popExpiring(this.codes, code);
  }

  async saveRefreshToken(token: string, record: RefreshTokenRecord, ttlSeconds: number): Promise<void> {
    this.refreshTokens.set(token, { value: record, expiresAt: now() + ttlSeconds });
  }

  async popRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
    return popExpiring(this.refreshTokens, token);
  }

  async saveSession(session: Session, ttlSeconds: number): Promise<void> {
    this.sessions.set(session.sessionId, { value: session, expiresAt: now() + ttlSeconds });
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt < now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return entry.value;
  }
}

/** Delete-then-validate, so an expired entry can never be replayed. */
function popExpiring<T>(map: Map<string, Expiring<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  map.delete(key);
  if (entry.expiresAt < now()) return null;
  return entry.value;
}

export const store: OAuthStore = new InMemoryOAuthStore();
