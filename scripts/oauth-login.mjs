#!/usr/bin/env node
/**
 * Walks the OAuth 2.0 + PKCE flow against a locally running gokit-mcp server
 * and prints a usable access token.
 *
 * It plays the part an MCP client normally plays: registers itself, generates
 * the PKCE pair, listens on a loopback redirect_uri to catch the auth code, and
 * exchanges it. Without this you would have to copy the code out of the browser
 * URL bar by hand.
 *
 *   node scripts/oauth-login.mjs                 # open the sign-in page in a browser
 *   node scripts/oauth-login.mjs --direct 4301 2 # skip the browser (direct mode only)
 *
 * Requires the server to be running with PORT set, e.g. `npm run start:http`.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const BASE = process.env.MCP_SERVER_URL ?? "http://localhost:3001";
const CALLBACK_PORT = Number(process.env.OAUTH_CALLBACK_PORT ?? 9876);
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;

const args = process.argv.slice(2);
const directIdx = args.indexOf("--direct");
const direct = directIdx !== -1;
const directUserId = direct ? args[directIdx + 1] : undefined;
const directAccountId = direct ? args[directIdx + 2] : undefined;

const die = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

// --- 0. is the server up, and which mode is it in? -------------------------
let meta;
try {
  const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  meta = await res.json();
} catch (err) {
  die(`No OAuth server at ${BASE} (${err.message}).\n  Start it with:  npm run start:http`);
}
console.log(`✓ OAuth server at ${BASE}`);
console.log(`  grants: ${meta.grant_types_supported?.join(", ")}`);

// --- 1. register this script as a client -----------------------------------
const client = await (
  await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "oauth-login.mjs", redirect_uris: [REDIRECT_URI] }),
  })
).json();
if (!client.client_id) die(`Registration failed: ${JSON.stringify(client)}`);
console.log(`✓ registered client_id=${client.client_id}`);

// --- 2. PKCE pair -----------------------------------------------------------
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("hex");

const authorizeUrl =
  `${BASE}/authorize?client_id=${encodeURIComponent(client.client_id)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;

// --- 3. get an auth code ----------------------------------------------------
let code;

if (direct) {
  // Post the callback ourselves, exactly as the login page's JS would.
  if (!directUserId) die("--direct needs a user_id, e.g. --direct 4301 2");
  const cb = await (
    await fetch(`${BASE}/oauth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: directUserId,
        account_id: directAccountId ?? "",
        email: process.env.OAUTH_EMAIL ?? "",
        password: process.env.TEST_LOGIN_PASSWORD ?? "",
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code_challenge: challenge,
        state,
      }),
    })
  ).json();
  if (!cb.redirect_url) die(`Callback rejected: ${JSON.stringify(cb)}`);
  code = new URL(cb.redirect_url).searchParams.get("code");
  console.log(`✓ direct-mode login as user_id=${directUserId}`);
} else {
  // Catch the browser redirect on the loopback address.
  code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const got = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<body style="font-family:system-ui;padding:3rem;background:#1a1a1a;color:#eee">
           <h2>${got ? "Signed in ✓" : "No code returned ✗"}</h2>
           <p>You can close this tab and return to the terminal.</p>
         </body>`,
      );
      server.close();
      if (!got) return reject(new Error("no code in redirect"));
      if (gotState !== state) return reject(new Error("state mismatch — possible CSRF"));
      resolve(got);
    });

    server.listen(CALLBACK_PORT, () => {
      console.log(`\n  Opening the sign-in page. If it doesn't open, visit:\n  ${authorizeUrl}\n`);
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(opener, [authorizeUrl], { stdio: "ignore", detached: true }).unref();
      console.log("  Waiting for the redirect... (Ctrl-C to abort)");
    });

    setTimeout(() => {
      server.close();
      reject(new Error("timed out after 5 minutes"));
    }, 300_000).unref();
  }).catch((err) => die(err.message));
}

console.log(`✓ auth code received`);

// --- 4. exchange it ---------------------------------------------------------
const tok = await (
  await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
    }),
  })
).json();

if (!tok.access_token) die(`Token exchange failed: ${JSON.stringify(tok)}`);
console.log(`✓ access token issued (expires in ${tok.expires_in}s)\n`);

// --- 5. prove it works ------------------------------------------------------
const listRes = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${tok.access_token}`,
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
const text = await listRes.text();
const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
try {
  const names = JSON.parse(line.replace(/^data: /, "")).result.tools.map((t) => t.name);
  console.log(`✓ tools/list returned ${names.length} tools: ${names.join(", ")}\n`);
} catch {
  console.log(`! tools/list returned HTTP ${listRes.status}: ${text.slice(0, 200)}\n`);
}

console.log("Export it and call tools directly:\n");
console.log(`  export TOKEN='${tok.access_token}'`);
console.log(`  curl -s -X POST ${BASE}/mcp \\`);
console.log(`    -H "Authorization: Bearer $TOKEN" \\`);
console.log(`    -H 'Content-Type: application/json' \\`);
console.log(`    -H 'Accept: application/json, text/event-stream' \\`);
console.log(`    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_company_by_orgno","arguments":{"orgno":"5590811518"}}}'\n`);
