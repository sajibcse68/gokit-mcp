# gokit-mcp

An MCP server exposing tools with interactive UI dashboards:

- `get_incidents` — Norwegian Police (Politiet) incident feed dashboard.
- `get_company_by_orgno` — Company short-info lookup by organization number.
- `get_company_people` — A company's contacts, with per-contact email reveal.
- `get_contact_email` — Reveals one contact's email (called from the contacts UI).

The Goava-backed tools authenticate as the signed-in user via OAuth 2.0 + PKCE — see
[Authentication](#authentication).

## Setup

```bash
npm install
```

Create a `.env` file in the repo root (already gitignored):

```
# Goava GraphQL endpoint
GOAVA_API_URL=https://dev-dataapi.goava.com/graphql

# Sign-in (Firebase project that issues the ID tokens)
FIREBASE_PROJECT_ID=goava-ping
FIREBASE_AUTH_DOMAIN=goava-ping.firebaseapp.com
FIREBASE_API_KEY=your-firebase-web-api-key

# Secret used to sign this server's own bearer tokens
JWT_SECRET=pick-a-long-random-string

# Public URL clients use to reach this server
MCP_SERVER_URL=http://localhost:3001
```

`GOAVA_API_TOKEN` is now only a **fallback** for when nobody is signed in (stdio mode, or
`MCP_AUTH_DISABLED=true`). It is a Firebase ID token and expires after an hour, so the
normal path is signing in — which yields a token the server refreshes automatically.

If the API is unreachable or the credentials are rejected, the Goava tools fall back to
clearly-labeled mock data rather than failing; check `source` in the response (see
[Verifying a tool call works](#verifying-a-tool-call-works)).

## Authentication

Starting the server with `PORT` set enables OAuth 2.0 with PKCE. An MCP client such as
Claude.ai discovers it automatically from the `401` + `WWW-Authenticate` response and walks
the flow:

```
register → authorize → (Google sign-in) → callback → token → /mcp
```

The user signs in with Google; the resulting **Firebase ID token becomes the credential the
server uses to call the Goava GraphQL API as that user**. Firebase ID tokens last one hour
while sessions last eight, so the server silently refreshes them in the background.

| Mode | When | Behaviour |
|---|---|---|
| **Firebase** | `FIREBASE_PROJECT_ID` is set | Google sign-in; ID tokens cryptographically verified against Google's public keys. This is the real mode. |
| **Direct** | `FIREBASE_PROJECT_ID` unset | The login page accepts a raw `user_id`. Exercises the OAuth flow without Google, but the Goava API will reject the session, so tools fall back to `GOAVA_API_TOKEN`. |
| **Disabled** | `MCP_AUTH_DISABLED=true` | No bearer check at all. Local curl testing only. |

Endpoints: `/health`, `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource`, `/register`, `/authorize`, `/oauth/callback`,
`/token`, `/test-login`, `/mcp`.

Visiting `/test-login` directly won't work — it needs the OAuth parameters that
`/authorize` attaches. Start the flow from a client, or from `/authorize`.

Build the view bundles once so the server has `dist/index.html` and `dist/company.html` to serve:

```bash
npm run build
```

## Run locally on port 3001

```bash
npm run start:http
```

This starts the MCP server over Streamable HTTP at `http://localhost:3001/mcp`. It's a one-shot start (no file watching) — re-run `npm run build` after changing view code, or use `npm run dev:http` instead to rebuild on save.

## Expose it publicly with a Cloudflare Tunnel

In a separate terminal, with the server still running:

```bash
cloudflared tunnel --url http://localhost:3001
```

This prints a free, ephemeral HTTPS URL like:

```
https://random-two-words.trycloudflare.com
```

The URL changes every time you restart the tunnel, and requires no Cloudflare account.

Set `MCP_SERVER_URL` to the tunnel URL before starting the server — it is what the OAuth
metadata and redirect URIs advertise, and the flow breaks if it still says `localhost`:

```bash
MCP_SERVER_URL=https://random-two-words.trycloudflare.com PORT=3001 npm start
```

⚠️ `/mcp` requires a bearer token, but every caller signs in as themselves and gets their own
Goava credentials. Don't set `MCP_AUTH_DISABLED` on a tunnel — that removes the bearer check
and falls back to *your* `GOAVA_API_TOKEN` for anyone who finds the URL.

## Connect it to Claude.ai

1. Go to **claude.ai → Settings → Connectors → Add custom connector**.
2. Paste the tunnel URL with the `/mcp` path appended, e.g. `https://random-two-words.trycloudflare.com/mcp`.
3. Save. Claude discovers the OAuth endpoints from the `401` response and prompts you to sign in.
4. Complete the Google sign-in. Claude then lists the tools and their UI resources.

## Verifying a tool call works

The tool result payload includes a `source` field:

- `"source": "live"` — the upstream API call succeeded.
- `"source": "mock"` — it failed (expired/missing credentials, unreachable API) and fell back to demo data; check the server's terminal output for a `console.error` line with the underlying error.

A `401 Unauthorized` from the Goava API in that log almost always means the credential expired.
Signing in again is the fix; a stale `GOAVA_API_TOKEN` in `.env` is the usual culprit when
running without auth.

For quick curl testing without going through the OAuth flow:

```bash
MCP_AUTH_DISABLED=true npm run start:http
```

For interactive testing without Claude.ai, use the official MCP Inspector, which supports the
OAuth flow directly:

```bash
npx @modelcontextprotocol/inspector node --env-file=.env node_modules/tsx/dist/cli.mjs server/index.ts
```
