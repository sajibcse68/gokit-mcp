# CLAUDE.md — gokit-mcp

Guidance for Claude Code when working in this repo.

The current project is **porting the Python `goava-mcp` server into this TypeScript repo, one tool
at a time**, while keeping the four tools that already work here running untouched.

> `goava-mcp` is under active development. §5 was last re-checked against it on **2026-10-06**
> (`master` @ `e8d8709`). Re-read `goava-mcp/tools/` and the registration block in `server_v2.py`
> before starting a tool — names and signatures have already changed once.

---

## 1. Repos involved

| Path | What it is | How to use it |
|---|---|---|
| `/Users/sajib/sources/github/sajibcse68/gokit-mcp` | **This repo.** TypeScript MCP server + React UI apps. | Where all new code goes. |
| `/Users/sajib/sources/bitbucket/goava/goava-mcp` | Python MCP server (FastMCP + Starlette). The source of truth for *what* each tool does. | **Read-only reference.** Never edit. |
| `/Users/sajib/sources/bitbucket/goava/webapp` | Goava's React webapp. The source of truth for *how* to call the Goava GraphQL API. | **Read-only reference.** Never edit. |

---

## 2. Hard rules

1. **Never break the existing tools.** `get_incidents`, `get_company_by_orgno`, `get_company_people`
   and `get_contact_email` currently work. Before finishing any change, run the verification
   steps in §9 and confirm all four still list and call successfully.
2. **Never edit `goava-mcp` or `webapp`.** Read them, copy the logic, but write only into this repo.
3. **One tool per change.** Do not start a second tool until the current one is registered,
   type-checks, builds, and has been called successfully end to end.
4. **Never commit secrets.** `.env` is gitignored and holds `GOAVA_API_TOKEN`. Tokens, JWT secrets,
   RDS passwords and Firebase service-account JSON go in env vars only — never in source, never in
   `README.md`, never in a commit message.
5. **GraphQL only for tool data.** See §4. Do not add `@aws-sdk/*`, `mysql2`/`pymysql` equivalents,
   or direct Lambda/RDS/DynamoDB access for tool data. If a tool cannot be served by GraphQL, stop
   and report the gap (§7) rather than reaching for AWS.
6. **Ask before inventing a GraphQL query.** Every query sent to the Goava API must be copied from
   `webapp/src/services/api/query/*.js` or `mutations/*.js`. Do not guess field names — the schema
   will reject them and you will get an unhelpful error.

---

## 3. This repo's architecture

```
server/
  index.ts      MCP server: tool + resource registration, stdio and HTTP transports
  goava.ts      Goava GraphQL client (gqlRequest) + company/people/email fetchers
  politiet.ts   Norwegian police API client (unrelated to Goava; leave alone)
shared/
  types.ts      Payload types shared between server and view. Server serializes, view parses.
view/
  *.html        One HTML entry per UI app
  src/*.tsx     One React "Block" component per UI app + its `*-main.tsx` mount file
  src/styles.css, variables.css   Shared Goava-styled CSS
vite.config.ts, vite.company.config.ts, vite.people.config.ts
                One config per HTML entry (vite-plugin-singlefile supports only one entry per build)
```

**How a UI tool works end to end:**

1. `registerAppTool(server, name, { …, _meta: { ui: { resourceUri: SOME_URI } } }, handler)`
   registers the tool and links it to a UI resource.
2. The handler returns `{ content: [{ type: "text", text: JSON.stringify(payload) }] }`.
   The payload type lives in `shared/types.ts`.
3. `registerAppResource(server, title, SOME_URI, { description }, …)` serves the built
   single-file HTML from `dist/`.
4. The React block uses `useApp()` from `@modelcontextprotocol/ext-apps/react`, reads
   `app.ontoolinput` / `app.ontoolresult`, and parses the JSON out of the text content with a local
   `extractPayload` helper. `useHostStyles(app, app?.getHostContext())` applies host theming.
5. A tool with **no** UI of its own (like `get_contact_email`, called from inside another app via
   `app.callServerTool`) uses the plain `server.registerTool` — `registerAppTool` requires `_meta.ui`.

**Fallback convention:** every payload carries `source: "live" | "mock"`. When the upstream call
fails, the fetcher logs to `console.error`, returns clearly-labeled fabricated data with
`source: "mock"`, and the tool handler prepends a `NOTE: …fabricated demo data…` text block.
Keep this pattern for every ported tool — it is how you tell a broken token from a broken query.

---

## 4. Decisions already made (do not re-litigate)

These were chosen by the repo owner on 2026-09-22:

| Decision | Choice |
|---|---|
| Backend access | **GraphQL only.** Use the same `https://dev-dataapi.goava.com/graphql` endpoint the webapp uses. Tools with no GraphQL equivalent are deferred, not ported via AWS. |
| Auth | **Port the full OAuth 2.0 + PKCE flow** from `goava-mcp/server_v2.py` (§6). |
| UI | **Every ported tool gets its own React UI** — HTML entry, vite config, block component. |

**Known tension, flagged and accepted:** three Python tools depend on backends that have no GraphQL
equivalent (§7). They cannot be completed under "GraphQL only". Port the parts that *are* covered,
and report the uncovered parts rather than silently dropping them or adding AWS calls.

---

## 5. Tool inventory and GraphQL mapping

`goava-mcp/server_v2.py` registers **seven** tools (lines ~846-860). `profile_company.py` and
`profile_company_v2.py` are **not registered** — ignore them unless asked. (`find_companies.py`,
`list_segments.py`, `create_segment.py`, `get_top_hits.py` and `demo_tools.py` have been deleted
upstream.)

**What changed since 2026-09-22** — if you read an earlier version of this file, these are now wrong:

| Was | Is now | When |
|---|---|---|
| `prospecting_autopilot` | **`prospecting_agent`** (module + tool name) | renamed 2026-09-13 (`dfe969c`) |
| `pipeline_research` | **`research_agent_automation`** (module + tool name) | renamed 2026-09-13 (`dfe969c`) |
| — | **`process_list`** — new 7th tool | added 2026-10-04 (`4605bc0`), all envs 2026-10-05 (`7856509`) |
| `prospector`: 4 actions, 746 lines | **5 actions** (`+ data_credits`), ~75 KB, contact drill-down | 2026-09-28 → 2026-10-02 |
| `get_opportunities(from_date, to_date)` | **`(from_date?, to_date?, opportunity_id?)`** | 2026-10-03 (`86962ff`) |

The rename commit's own message says the point was to *"disambiguate from `prospecting_agent`"* —
`prospecting_agent` (scheduled/signal prospecting rules) and `research_agent_automation` (AI research
queries) are different features. Don't let the old names blur them.

New shared helpers to read before porting anything: `tools/_authorize.py` (market/account/feature
authorization on filter dimensions) and `tools/_images.py` (verifies contact image URLs actually
serve an image). New backend client: `aws/data_credits_client.py`.

Suggested porting order — simplest and best-covered first:

| # | Python tool | What it does | GraphQL equivalent in `webapp` | Status |
|---|---|---|---|---|
| 1 | `prospecting_agent` (`tools/prospecting_agent.py`) | `get` / `add` / `edit` / `remove` / `get_lists` on prospecting-agent rules. `get_sprint_details` and `mutate_signal_agent` are **still commented out** upstream — skip them. | `query/settings.js` → `getProspectingAutopilotSettings`; `mutations/settings.js` → `createAutoPropectingPilotSettings`, `updateAutoPropectingPilotSettings`, `removeAutoPropectingPilotSettings`; list-name enrichment via `query/users.js` → `getAllUsers { lists { id name } }`; signal-instruction enrichment via `query/settings.js` → `getUserSignalFeedback($user_id)` | ✅ Fully covered |
| 2 | `process_list` (`tools/process_list.py`) | `copy` / `move` / `remove` companies between the user's lists and the customers (client) relation. Selection by `orgnos` or by `filters`. Has `dry_run` (default **true**) and a `repeat` guard. | `mutations/lists.js` → `processList($action: String!, $prospectRequest: ProspectRequest!, $salesPipelineCriteria, $contacts, $export_contacts)` — the same list engine Discover drives | ⚠️ Mostly covered — the DynamoDB dedup guard has no GraphQL equivalent, see §7 |
| 3 | `research_agent_automation` (`tools/research_agent_automation.py`) | `get` / `add` / `update` / `remove` / `get_users` / `get_lists` / `get_team_filter_data` | `query/settings.js` → `getPipelineResearchQueries`; `mutations/settings.js` → `createPipelineResearchQuery`, `updatePipelineResearchQuery`, `removePipelineResearchQuery`; `query/users.js` → `getAllUsers` (also supplies `lists` for `get_lists`) | ⚠️ Partial — `get_team_filter_data` and the admin-role gate are uncovered, see §7 |
| 4 | `prospector` (`tools/prospector.py`) | `search` / `create_segment` / `create_icp` / `get_user_info` / **`data_credits`**. Search now also drills down to contacts via `child_type: "contact"` + `contact_fields` / `child_order` / `number_of_contacts`. | Companies: `query/list.js` → `getProspects($prospectRequest: ProspectRequest!)`, `getCompanyList`; `query/filter.js` → `getProspectorFilters`; `mutations/lists.js` → `addFilter`, `updateFilter`, `createCompanyList`; `mutations/idealCustomerProfiles.js` → `createUserScoreProfile`. Contacts: `query/list.js` → `getPeopleData($prospectRequest)`, `getPeopleCount`; `query/people.js` → `getContactEmail` | ⚠️ Partial — now ~75 KB, by far the largest tool. Port `search` (companies) first, then contacts, then the create actions. `data_credits` and the contacts feature gate are uncovered, see §7 |
| 5 | `research_filter` (`tools/research_filter.py`) | List segments **and** resolve free text → structured filters | Segment listing: `query/list.js` → `getSaveFilters`, `getListFilterDetails`. Free-text resolution: ❌ none | ⚠️ Partial — see §7 |
| 6 | `get_company_profile` (`tools/get_company_profile.py`) | Return the cached ICP/segment report for the caller's own company. Takes no arguments — everything is resolved from the session. | ICP reads: `query/idealCustomerProfiles.js` → `getUserScoreProfiles`, `getICPDetails`, `GetUserPipelineICPs`. Report-readiness polling: ❌ none | ⚠️ Partial — see §7 |
| 7 | `get_opportunities` (`tools/get_opportunities.py`) | List opportunities/signals for a date range, **or** fetch one by `opportunity_id` (a UUID; dates are then ignored) | ❌ none — only `mutations/opportunity.js` → `submitOpportunityFeedback` | ❌ Blocked — see §7 |

> `createAutoPropectingPilotSettings` / `updateAutoPropectingPilotSettings` /
> `removeAutoPropectingPilotSettings` are spelled that way in Goava's GraphQL schema — "Propecting",
> not "Prospecting". Copy them verbatim; correcting the typo breaks the call. Your spell-checker
> will flag it.

**The Python tool descriptions are the product spec.** `research_filter` and `prospector` carry very
long `description=` strings encoding filter dimensions, retry heuristics, localization rules and
validation requirements. Port those descriptions **verbatim** into the `description` field of the
TypeScript tool — they are what makes the tool usable by a model, and rewording them changes behaviour.

---

## 6. The OAuth 2.0 + PKCE port — **DONE**

Implemented in [server/auth/](server/auth/), ported from `goava-mcp/server_v2.py`. Library: **`jose`**
(zero-dependency, ESM-native) — it both signs our HS256 bearer tokens and verifies Firebase ID tokens
against Google's public JWKS, so this repo needs **no `firebase-admin` and no service-account JSON**.

| File | Role |
|---|---|
| `server/auth/config.ts` | Env config. Names match `server_v2.py` so deployment config transfers. |
| `server/auth/store.ts` | `OAuthStore` interface + in-memory impl (clients, codes, refresh tokens, sessions). |
| `server/auth/pkce.ts` | S256 verification via `node:crypto`, constant-time compare. |
| `server/auth/tokens.ts` | Issue/verify our bearer JWT. Claim names match Python's `issue_bearer_token`. |
| `server/auth/firebase.ts` | Verify Firebase ID tokens via remote JWKS; refresh them via `securetoken.googleapis.com`. |
| `server/auth/context.ts` | `AsyncLocalStorage` session context + `currentGoavaToken()`. |
| `server/auth/routes.ts` | All endpoints + `authenticateRequest` for `/mcp`. |
| `server/auth/testLogin.ts` | Built-in login page with real Google sign-in. |

**The central design difference from `goava-mcp`.** The Python server's tools call AWS Lambda/RDS with
IAM credentials, so its JWT only needs to carry *who you are*. This repo calls the Goava GraphQL API,
which authenticates with the **raw Firebase ID token** as the `authorization` header — no `Bearer `
prefix (see `webapp/src/services/api/axios.js:36`). So a session here must carry the *credential*, not
just the claims:

1. `/oauth/callback` verifies the Firebase ID token and stores it in a server-side `Session`.
2. The auth code, and then the bearer JWT, carry only the opaque `sid`.
3. `authenticateRequest` resolves `sid` → `Session` and `runWithSession` binds it for the request.
4. `gqlRequest` in `server/goava.ts` calls `currentGoavaToken()` to get that user's own token.

Firebase ID tokens last 1 hour but our bearer tokens last 8, so `currentGoavaToken()` transparently
refreshes via the Firebase refresh token (needs `FIREBASE_API_KEY`) 120s before expiry.

**Two traps worth keeping in mind if you touch this:**

- `currentGoavaToken()` must return `null`, never `""`, when a session has no Firebase token
  (direct mode). `?? GOAVA_API_TOKEN` does not treat `""` as absent, so returning `""` sends an empty
  `authorization` header and silently breaks every Goava tool. There is a comment on the guard.
- The session **must** live in `AsyncLocalStorage`. `server/index.ts` builds a fresh `McpServer` per
  request and requests interleave, so a module-level variable hands one user's token to another
  user's tool call.

**Endpoints** (all implemented; mirrors Python `create_app()`, ~line 900):

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Public |
| GET | `/.well-known/oauth-authorization-server` | RFC 8414 metadata |
| GET | `/.well-known/oauth-protected-resource` (+ `/mcp` suffix alias) | RFC 9728 |
| POST | `/register`, `/oauth/register` | Dynamic client registration → returns `client_id`, 201 |
| GET | `/authorize`, `/oauth/authorize` | Validates `client_id`, 302s to `FRONTEND_LOGIN_URL` with `mcp_callback`, `client_id`, `redirect_uri`, `code_challenge`, `state` |
| POST | `/oauth/callback` | Login page posts identity; server saves a one-time auth code, returns `{ redirect_url }` |
| POST | `/token`, `/oauth/token` | **form-encoded**, not JSON. Verifies PKCE S256, pops the code, issues HS256 JWT. Supports `authorization_code` and `refresh_token` grants |
| GET | `/test-login` | Built-in dev login page |
| GET/POST/DELETE | `/mcp` | Bearer-protected MCP endpoint |

**Behaviour worth preserving:**

- **PKCE S256 only.** `/authorize` rejects `code_challenge_method=plain` — `plain` defeats the point.
  Comparison is `crypto.timingSafeEqual`, never `===`.
- **JWT claims**: `user_id`, `client_id`, `account_id`, `email`, `name`, `language`, `user_markets`,
  `sid`, `iat`, `exp`. TTLs: auth code 300s, bearer 8h, refresh 90d.
- **Legacy claim fallback**: `user_id` ?? `goava_user_id` ?? `sub`, so `goava-mcp`-issued tokens work.
- **Auth codes and refresh tokens are single-use.** `popAuthCode`/`popRefreshToken` delete *before*
  checking expiry, so an expired entry can never be replayed. Refresh tokens rotate on every use.
- **Responses are never buffered**, or SSE streaming breaks. Auth is a check at the top of the
  `node:http` handler, before `transport.handleRequest`.
- **CORS before auth**, so `OPTIONS` preflight is never rejected. Preserve that ordering.
- **Two identity modes.** *Firebase mode* when `FIREBASE_PROJECT_ID` is set — the ID token is verified
  and becomes the Goava API credential. *Direct mode* otherwise — trusts the posted `user_id`,
  optionally gated by `TEST_LOGIN_PASSWORD`. Direct mode is what makes local dev possible, but its
  sessions carry no Goava credential, so tools fall back to `GOAVA_API_TOKEN`.
- **`MCP_AUTH_DISABLED=true`** skips the bearer check entirely for local curl testing. Auth is on by
  default whenever `PORT` is set; stdio mode is always unauthenticated.

**Storage exception to the "GraphQL only" rule.** OAuth clients, auth codes, refresh tokens and
sessions are server bookkeeping, not Goava tool data. They live behind the `OAuthStore` interface in
`server/auth/store.ts`, currently backed by an in-memory implementation — state is lost on restart
(the user re-authorizes) and is **not shared between processes**, so a multi-instance deployment
needs a real backing store. Swap the implementation, don't change the call sites. Do not add the
DynamoDB SDK without asking.

**`validate_user_account` is deliberately dropped.** Python's `BearerTokenMiddleware` re-validates
`user_id`/`account_id`/`email` against `prod_infosource.app_account_user` over MySQL on every
request. That table is not reachable under GraphQL-only, so this server trusts the signed JWT claims.
There is a `NOTE:` comment at the end of `authenticateRequest` marking it.

---

## 7. Known gaps — report, don't work around

When you reach one of these, implement everything around it, then say plainly what is missing.
Do **not** add AWS SDK calls, and do **not** quietly ship a tool that silently omits a capability.

1. **`research_filter` free-text → filter resolution.** Python calls the
   `prod--goava-filter-resolver` Lambda (`LAMBDA_GOAVA_FILTER_RESOLVER`). The webapp's
   `suggestFilters($ICP_id, $ICP_variant)` is **not** the same thing — it suggests filters from an
   existing ICP id, not from a natural-language string. The segment-listing half of the tool
   (`getSaveFilters` / `getListFilterDetails`) can be ported now.

2. **`get_opportunities`.** Python calls the `getOpportunities` Lambda. The webapp has no read query
   for opportunities at all — only a `submitOpportunityFeedback` mutation. Nothing to port until a
   GraphQL query exists.

3. **`get_company_profile` report polling.** Python reads the `company_analysis_chatbot_prep`
   DynamoDB table and treats `report_url` as the completion signal. The ICP data itself is reachable
   via `getUserScoreProfiles` / `getICPDetails` / `GetUserPipelineICPs`, but the
   `started` → `pending` → `complete` status machine in `goava-mcp/helpers.py` has no GraphQL
   equivalent. Port the ICP read; omit the polling status.

4. **`research_agent_automation` action `get_team_filter_data`.** Python calls the same
   `prod--goava-filter-resolver` Lambda as gap 1, with
   `{ request_identifier: "team_filter_data", refresh, user_id, account_id }`. No GraphQL
   equivalent. Note that `research_filter`'s description tells the model to call this action to
   validate `company_lists` / `client_relation` / `company_in_crm` ids — so gaps 1 and 4 together
   remove the whole list-validation loop. Port the other six actions; report this one.

5. **`research_agent_automation` admin-role gate.** `get_users`, and `get_lists` with `target_user_ids`, are
   restricted to `CLIENT_ADMIN` / `SUPER_ADMIN`, resolved from `GoavaBO.user_system_role` via
   `get_user_roles_by_id`. No GraphQL query exposes `system_role_id` (`getAllUsers` returns no role
   field). Do **not** silently drop the gate and expose the whole account's user list — either
   carry the role in the JWT claims at login, or return "not supported" for those paths. Say which
   one you did.

6. **`account_id` / user profile resolution.** Python resolves `orgno` from
   `prod_infosource.app_account` and hydrates `name`/`language`/`markets` from `GoavaBO.user`
   (`aws/data_rds_client.py`). Under GraphQL-only these must come from the Firebase token claims
   set at login. Direct mode will therefore have thinner user context than the Python server.

   *Good news for `_authorize.py`:* its market check reads `user_markets` straight off the user
   context, and its `client_relation` / `company_in_crm` check compares against `account_id`. Both
   are already JWT claims here (§6), so that part of `_authorize.py` ports as-is.

7. **`prospector` action `data_credits`, and the metered contact fetch.** Contact details are
   priced. Python routes them through its own `goava-data-credits` Lambda
   (`DATA_CREDITS_LAMBDA_ARN`, `aws/data_credits_client.py`), which reserves credits, executes the
   ProspectorList call and reports a per-field cost breakdown. The webapp's `getAllExportCredits`
   returns **balances only** — no reserve/charge/execute path. So: contact *data* is reachable via
   `getPeopleData`, but the *billing* around it is not. Do not port contact fetching in a way that
   bypasses metering — port the read, and report that credits are unenforced, so nobody ships an
   unmetered path to a priced resource by accident.

8. **The contacts feature gate.** `tools/_authorize.py` → `authorize_contacts_access` checks
   `prod_infosource.app_feature_authorization` for the `contacts_in_mcp` feature
   (`FEATURE_CONTACTS_IN_MCP`) and **fails closed** on any DB error. No GraphQL query exposes
   feature authorization. Preserve the fail-closed behaviour: if the gate can't be evaluated, deny.
   Either carry the flag as a JWT claim at login or return "not supported" — say which you did.

9. **`process_list`'s safety rails.** The GraphQL `processList` mutation covers the operation
   itself, but not the guards Python wraps around it:
   - **Dedup guard** — `claim_list_operation` / `finish_list_operation` write to the DynamoDB table
     `<env>-mcp-process-list-ops` (`PROCESS_LIST_DEDUP_SECONDS`, default 900s) so an identical
     operation can't run twice. No GraphQL equivalent.
   - **List validation** — `get_list_by_id` (RDS) confirms the list belongs to the account *and*
     has an owner row, because the engine silently skips owner-less lists.

   This tool **mutates customer data**, so the rails matter more than the operation. Keep
   `dry_run: true` as the default, and if you ship it without the dedup guard, say so plainly —
   a repeated `move` is not recoverable from the tool side.

---

## 8. Step-by-step: porting one tool

1. **Read the Python tool end to end**, including its `description` string and every helper it
   imports from `tools/_resolve.py`, `tools/_validate.py`, `helpers.py`.
2. **Find the GraphQL query** in `webapp/src/services/api/query/*.js` or `mutations/*.js`. Read the
   calling wrapper in `webapp/src/services/api/*.js` too — it shows the exact `variables` shape.
   The webapp's call pattern is `$axios.post('', { query, variables })` against the GraphQL base URL;
   `server/goava.ts`'s `gqlRequest` is the direct equivalent. Reuse it, do not write a second client.
3. **Add payload types to `shared/types.ts`** — a `Foo` entity type, a `FooPayload` with
   `fetchedAt` and `source`, and a `GetFooArgs` for the tool input.
4. **Add the fetcher to `server/goava.ts`**: the query constant, a `RawFoo` interface matching the
   API's snake_case shape, a `normalizeFoo` mapping it to camelCase, a `MOCK_FOO` constant, and an
   exported `fetchFoo()` wrapping `gqlRequest` in try/catch with the mock fallback.
5. **Register the tool in `server/index.ts`** with `registerAppTool` + a `zod` input schema, and a
   matching `registerAppResource` pointing at a new `ui://goava/<name>.html` URI.
6. **Add the UI**: `view/<name>.html`, `view/src/<name>-main.tsx`, `view/src/<Name>Block.tsx`, and
   `vite.<name>.config.ts` (copy `vite.company.config.ts`, change the `input` path only).
7. **Wire the new vite config into `package.json`** — append it to the `build`, `dev` and `dev:http`
   script chains. Forgetting this is the most common failure: the tool registers fine but
   `registerAppResource` throws `ENOENT` on `dist/<name>.html` at call time.
8. **Verify** (§9).
9. **Update `README.md`** — the tool list at the top is user-facing and currently lists only two of
   the four existing tools. Bring it current as you go.

---

## 9. Verification — run all of these before calling a tool done

```bash
npm run typecheck                    # both tsconfigs: server and view
npm run build                        # all vite bundles; confirm dist/<name>.html exists
```

Then start the server and exercise it:

```bash
npm run start:http                   # Streamable HTTP on http://localhost:3001/mcp
```

```bash
# list tools — the new one plus all four pre-existing ones must appear
curl -s -X POST http://localhost:3001/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# call it
curl -s -X POST http://localhost:3001/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"<tool>","arguments":{}}}'
```

Once OAuth lands, add `-H "Authorization: Bearer $TOKEN"` to both.

**Read the `source` field in the response.** `"live"` means the GraphQL call succeeded.
`"mock"` means it failed and fell back — check the server terminal for the `console.error` line.
A tool that only ever returns `"mock"` is not ported, it is stubbed.

Interactive testing:

```bash
npx @modelcontextprotocol/inspector node --env-file=.env node_modules/tsx/dist/cli.mjs server/index.ts
```

---

## 10. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | *(unset)* | Set → Streamable HTTP + OAuth. Unset → stdio, no auth. |
| `GOAVA_API_URL` | `https://dev-dataapi.goava.com/graphql` | GraphQL endpoint. |
| `GOAVA_API_TOKEN` | `""` | **Fallback only** — used when there is no signed-in session (stdio, direct mode, `MCP_AUTH_DISABLED`). The normal path is the user's own Firebase ID token. |
| `MCP_SERVER_URL` | `http://localhost:3001` | Public URL; appears in OAuth metadata and redirects. Must match how clients reach the server. |
| `FRONTEND_LOGIN_URL` | `${MCP_SERVER_URL}/test-login` | Where `/authorize` sends the browser. Point at the real sign-in page in production. |
| `ALLOWED_ORIGINS` | `https://dev-discover.goava.com,https://claude.ai` | Origins allowed to POST `/oauth/callback`. `MCP_SERVER_URL`'s own origin is always allowed. |
| `JWT_SECRET` | `change-me-in-production` | HS256 secret for our bearer tokens. Warns loudly at startup if left at the default. |
| `TEST_LOGIN_PASSWORD` | `""` | When set, direct-mode login requires this password. |
| `FIREBASE_PROJECT_ID` | *(unset)* | Set → Firebase mode (ID tokens verified). Unset → direct mode. |
| `FIREBASE_API_KEY` | *(unset)* | Web API key. Needed to refresh an expired ID token and for the built-in login page. |
| `FIREBASE_AUTH_DOMAIN` | `<project>.firebaseapp.com` | Used by the built-in login page. |
| `MCP_AUTH_DISABLED` | `false` | `true` skips the bearer check on `/mcp`. Local testing only. |

`goava-mcp`'s `FIREBASE_SERVICE_ACCOUNT_B64` has **no equivalent here** — `jose` verifies against
Google's public JWKS, so no service-account private key is needed.

Goava GraphQL environments (`webapp/src/config.js`):
`https://dataapi.goava.com/graphql` (prod) · `https://staging-dataapi.goava.com/graphql` ·
`https://dev-dataapi.goava.com/graphql` (dev — the default here).

---

## 11. Code style

Match `server/goava.ts` and `server/index.ts`, which are the house style:

- Two-space indent, double-quoted strings, semicolons, trailing commas in multiline literals.
- ESM with explicit `.js` extensions on relative imports (`./goava.js`) — required by
  `module: NodeNext`. Importing `./goava` without the extension will not resolve.
- `interface` for object shapes, `import type` for type-only imports.
- Comments explain *why*, and cite the webapp file they mirror when porting
  (e.g. `/** Mirrors PersonItem.jsx's handleEmailIconClick → getContactEmail. */`). Keep doing this —
  it is how the next reader finds the upstream source.
- No new runtime dependencies without asking. The server side currently needs only
  `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps` and `zod`; `fetch` is built in.
  OAuth will need a JWT library — propose one before installing.
