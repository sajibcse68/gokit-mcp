import { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, TEST_LOGIN_PASSWORD } from "./config.js";

/**
 * Built-in login page, served at /test-login.
 *
 * goava-mcp's version only collects a user_id and trusts it. This one also does
 * a real Google sign-in through the Firebase Web SDK when Firebase is
 * configured, because this server needs the resulting ID token to call the
 * Goava GraphQL API on the user's behalf — a bare user_id would not be enough.
 *
 * Point FRONTEND_LOGIN_URL at the real login page to use this only in dev.
 */
export function renderTestLoginPage(): string {
  const firebaseConfigured = Boolean(FIREBASE_PROJECT_ID && FIREBASE_API_KEY);
  const config = JSON.stringify({
    apiKey: FIREBASE_API_KEY,
    authDomain: FIREBASE_AUTH_DOMAIN || `${FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: FIREBASE_PROJECT_ID,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in - Goava MCP</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #1a1a1a; color: #eee;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
    .box { background: #2a2a2a; border: 2px solid #f59e0b; border-radius: 8px; padding: 2rem; width: 100%; max-width: 420px; }
    .badge { background: #f59e0b; color: #000; font-weight: bold; padding: .2rem .6rem; border-radius: 4px; font-size: .75rem; }
    h2 { margin: .75rem 0 1rem; font-size: 1.2rem; }
    p.hint { font-size: .8rem; color: #aaa; margin-top: 0; line-height: 1.5; }
    label { font-size: .8rem; color: #aaa; display: block; margin-bottom: .3rem; }
    input { width: 100%; padding: .5rem; background: #111; color: #eee; border: 1px solid #444;
            border-radius: 4px; font-size: 1rem; margin-bottom: 1rem; box-sizing: border-box; }
    button { width: 100%; padding: .65rem; background: #f59e0b; color: #000; border: none; border-radius: 4px;
             font-weight: bold; font-size: 1rem; cursor: pointer; }
    button:hover:not(:disabled) { background: #d97706; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .params { background: #111; border-radius: 4px; padding: .75rem; font-size: .75rem; color: #888;
              margin-bottom: 1.2rem; word-break: break-all; line-height: 1.6; }
    .err { color: #f87171; font-size: .85rem; margin-top: .75rem; }
    .ok { color: #4ade80; font-size: .85rem; margin-top: .75rem; }
    .sep { border: 0; border-top: 1px solid #444; margin: 1.5rem 0; }
  </style>
</head>
<body>
<div class="box">
  <div><span class="badge">TEST MODE</span></div>
  <h2>Goava MCP Sign-in</h2>
  <p class="hint">
    This is the server's built-in login page. Set
    <code>FRONTEND_LOGIN_URL</code> to the real sign-in page for production.
  </p>
  <div class="params" id="params"></div>

  <div id="google-section" style="display:none">
    <button id="google-btn">Sign in with Google</button>
    <p class="hint" style="margin-top:.75rem">
      Signs in against Firebase project <code>${escapeHtml(FIREBASE_PROJECT_ID)}</code> and hands the
      resulting ID token to the MCP server, which uses it to call the Goava API as you.
    </p>
  </div>

  <div id="direct-section" style="display:none">
    <hr class="sep" id="direct-sep" />
    <p class="hint"><b>Direct mode</b> — no Firebase verification. The Goava API will reject
    these credentials; useful only for exercising the OAuth flow itself.</p>
    ${TEST_LOGIN_PASSWORD ? '<label for="pwd">password</label><input id="pwd" type="password" placeholder="required" />' : ""}
    <label for="uid">user_id</label>
    <input id="uid" type="text" placeholder="e.g. 4301" />
    <label for="aid">account_id</label>
    <input id="aid" type="text" placeholder="e.g. 2" />
    <label for="eml">email</label>
    <input id="eml" type="text" placeholder="e.g. dev@goava.com" />
    <button id="direct-btn">Complete Login (direct)</button>
  </div>

  <div class="err" id="err"></div>
  <div class="ok" id="ok"></div>
</div>

<script type="module">
  const FIREBASE_ENABLED = ${firebaseConfigured};
  const FIREBASE_CONFIG = ${config};

  const p = new URLSearchParams(window.location.search);
  const err = document.getElementById('err');
  const ok = document.getElementById('ok');

  document.getElementById('params').innerHTML =
    '<b>OAuth params</b><br>' +
    'client_id: ' + (p.get('client_id') || '-') + '<br>' +
    'state: ' + (p.get('state') || '-') + '<br>' +
    'mcp_callback: ' + (p.get('mcp_callback') || '-');

  document.getElementById('google-section').style.display = FIREBASE_ENABLED ? 'block' : 'none';
  document.getElementById('direct-section').style.display = FIREBASE_ENABLED ? 'none' : 'block';
  if (!FIREBASE_ENABLED) document.getElementById('direct-sep').style.display = 'none';

  async function postCallback(body) {
    err.textContent = '';
    const callback = p.get('mcp_callback');
    if (!callback) { err.textContent = 'mcp_callback missing — open this page via /oauth/authorize.'; return; }
    const resp = await fetch(callback, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        client_id: p.get('client_id'),
        redirect_uri: p.get('redirect_uri'),
        code_challenge: p.get('code_challenge'),
        state: p.get('state') || '',
      }),
    });
    const data = await resp.json();
    if (data.redirect_url) {
      ok.textContent = 'Signed in — returning to the app...';
      window.location.href = data.redirect_url;
    } else {
      err.textContent = data.error_description || data.error || 'callback failed';
    }
  }

  if (FIREBASE_ENABLED) {
    const btn = document.getElementById('google-btn');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      err.textContent = '';
      try {
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js');
        const { getAuth, GoogleAuthProvider, signInWithPopup } =
          await import('https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js');

        const auth = getAuth(initializeApp(FIREBASE_CONFIG));
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        const idToken = await result.user.getIdToken();

        await postCallback({
          firebase_id_token: idToken,
          firebase_refresh_token: result.user.refreshToken || '',
        });
      } catch (e) {
        err.textContent = e && e.message ? e.message : String(e);
      } finally {
        btn.disabled = false;
      }
    });
  } else {
    document.getElementById('direct-btn').addEventListener('click', async () => {
      const pwdEl = document.getElementById('pwd');
      const uid = document.getElementById('uid').value.trim();
      if (!uid) { err.textContent = 'user_id is required'; return; }
      try {
        await postCallback({
          password: pwdEl ? pwdEl.value : '',
          user_id: uid,
          account_id: document.getElementById('aid').value.trim(),
          email: document.getElementById('eml').value.trim(),
        });
      } catch (e) {
        err.textContent = e && e.message ? e.message : String(e);
      }
    });
  }
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
