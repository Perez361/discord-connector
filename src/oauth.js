import crypto from "node:crypto";

// authCodes is in-memory and short-lived (5 min) by design — a restart
// mid-login just means retrying the login form, which is rare and cheap.
//
// Access/refresh tokens are deliberately NOT random values stored in memory:
// this runs on hosts (e.g. Render's free tier) that restart the process on
// every redeploy and after any idle period, which would silently wipe an
// in-memory token store and break the connector until the user manually
// reauthorized. Instead, once a login is validated, we hand back the
// CONNECTOR_API_KEY itself as the token — validating it is then a pure
// string comparison against the env var, so it survives restarts for free.
const authCodes = new Map(); // code -> { redirectUri, codeChallenge, expiresAt }

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_S = 60 * 60 * 24 * 30;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function verifyPkce(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hash) === challenge;
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function renderLoginForm({ client_id, redirect_uri, code_challenge, code_challenge_method, state, error }) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Authorize discord-connector</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 16px; color: #1a1a1a; }
  input[type=password] { width: 100%; padding: 8px; font-size: 16px; box-sizing: border-box; margin-top: 8px; }
  button { margin-top: 12px; padding: 8px 16px; font-size: 16px; cursor: pointer; }
  .error { color: #c00; margin-top: 8px; }
</style>
</head>
<body>
  <h2>Authorize access to discord-connector</h2>
  <p>Enter the connector API key (the <code>CONNECTOR_API_KEY</code> you configured on the server) to let Claude use your Discord tools.</p>
  <form method="POST" action="/authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(client_id || "")}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri || "")}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge || "")}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method || "")}">
    <input type="hidden" name="state" value="${escapeHtml(state || "")}">
    <input type="password" name="api_key" placeholder="Connector API key" autofocus required>
    <button type="submit">Authorize</button>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
  </form>
</body>
</html>`;
}

export function registerOAuthRoutes(app) {
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    const base = baseUrl(req);
    res.json({ resource: `${base}/mcp`, authorization_servers: [base] });
  });

  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const base = baseUrl(req);
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  app.post("/register", (req, res) => {
    const redirectUris = req.body?.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      return res
        .status(400)
        .json({ error: "invalid_client_metadata", error_description: "redirect_uris is required" });
    }
    // Not persisted: redirect_uri is re-validated against the auth code at
    // token-exchange time anyway, so there's nothing meaningful to look up
    // a stored client record for, and skipping storage removes another
    // thing a process restart could otherwise wipe.
    const clientId = randomToken(16);
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  app.get("/authorize", (req, res) => {
    const { client_id, redirect_uri, response_type, code_challenge, code_challenge_method, state } = req.query;

    if (response_type !== "code") return res.status(400).send("Only response_type=code is supported.");
    if (!redirect_uri) return res.status(400).send("Missing redirect_uri.");
    if (code_challenge_method !== "S256" || !code_challenge) {
      return res.status(400).send("PKCE with S256 is required.");
    }

    const apiKey = process.env.CONNECTOR_API_KEY;
    if (!apiKey) {
      const code = randomToken();
      authCodes.set(code, { redirectUri: redirect_uri, codeChallenge: code_challenge, expiresAt: Date.now() + CODE_TTL_MS });
      const redirect = new URL(redirect_uri);
      redirect.searchParams.set("code", code);
      if (state) redirect.searchParams.set("state", state);
      return res.redirect(redirect.toString());
    }

    res.type("html").send(
      renderLoginForm({ client_id, redirect_uri, code_challenge, code_challenge_method, state, error: null })
    );
  });

  app.post("/authorize", (req, res) => {
    const { client_id, redirect_uri, code_challenge, code_challenge_method, state, api_key } = req.body || {};
    const apiKey = process.env.CONNECTOR_API_KEY;

    if (!apiKey || api_key !== apiKey) {
      return res
        .type("html")
        .status(401)
        .send(
          renderLoginForm({
            client_id,
            redirect_uri,
            code_challenge,
            code_challenge_method,
            state,
            error: "Incorrect key. Try again.",
          })
        );
    }

    const code = randomToken();
    authCodes.set(code, { redirectUri: redirect_uri, codeChallenge: code_challenge, expiresAt: Date.now() + CODE_TTL_MS });
    const redirect = new URL(redirect_uri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    res.redirect(redirect.toString());
  });

  app.post("/token", (req, res) => {
    const grantType = req.body?.grant_type;

    if (grantType === "authorization_code") {
      const { code, redirect_uri, code_verifier } = req.body;
      const entry = authCodes.get(code);
      if (!entry || Date.now() > entry.expiresAt) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      authCodes.delete(code);
      if (entry.redirectUri !== redirect_uri) {
        return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
      }
      if (!verifyPkce(code_verifier, entry.codeChallenge)) {
        return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      }
      const apiKey = process.env.CONNECTOR_API_KEY || "dev-mode-no-key-configured";
      return res.json({
        access_token: apiKey,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_S,
        refresh_token: apiKey,
      });
    }

    if (grantType === "refresh_token") {
      const apiKey = process.env.CONNECTOR_API_KEY || "dev-mode-no-key-configured";
      if (req.body?.refresh_token !== apiKey) {
        return res.status(400).json({ error: "invalid_grant" });
      }
      return res.json({
        access_token: apiKey,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_S,
      });
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  });
}
