# gokit-mcp

An MCP server exposing tools with interactive UI dashboards:

- `get_incidents` — Norwegian Police (Politiet) incident feed dashboard.
- `get_company_by_orgno` — Company short-info lookup by organization number.

## Setup

```bash
npm install
```

Set the Goava API token (used by `get_company_by_orgno`). Create a `.env` file in the repo root (already gitignored):

```
GOAVA_API_TOKEN=your-token-here
```

Without a token (or if the API is unreachable), `get_company_by_orgno` falls back to clearly-labeled mock data instead of failing.

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

⚠️ The server has no auth and allows any origin. Anyone with the tunnel URL can call its tools (including the Goava-backed one, using your token). Fine for short test sessions; don't leave it running unattended.

## Connect it to Claude.ai

1. Go to **claude.ai → Settings → Connectors → Add custom connector**.
2. Paste the tunnel URL with the `/mcp` path appended, e.g. `https://random-two-words.trycloudflare.com/mcp`.
3. Save. Claude will discover both tools and their UI resources.

## Verifying a tool call works

The tool result payload includes a `source` field:

- `"source": "live"` — the upstream API call succeeded.
- `"source": "mock"` — it failed (bad/missing token, unreachable API) and fell back to demo data; check the server's terminal output for a `console.error` line with the underlying error.

For interactive testing without Claude.ai, use the official MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node --env-file=.env node_modules/tsx/dist/cli.mjs server/index.ts
```
