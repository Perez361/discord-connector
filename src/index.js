#!/usr/bin/env node
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerChannelTools } from "./tools/channels.js";
import { registerGuildTools } from "./tools/guilds.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerOAuthRoutes } from "./oauth.js";
import { getDiscordClient } from "./discordClient.js";

function buildServer() {
  const server = new McpServer({ name: "discord-connector", version: "0.3.0" });
  registerGuildTools(server);
  registerChannelTools(server);
  registerMessageTools(server);
  return server;
}

// The OAuth flow in oauth.js always hands back CONNECTOR_API_KEY itself as
// the token (see the comment there for why), so a manually configured header
// (e.g. Claude Code's .mcp.json) and a token obtained via claude.ai's OAuth
// dance both end up as the exact same value here — one plain comparison.
function requireAuth(req, res, next) {
  const apiKey = process.env.CONNECTOR_API_KEY;
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!apiKey) return next();
  if (token === apiKey) return next();

  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || `${proto}://${req.get("host")}`;
  res.set("WWW-Authenticate", `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`);
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
registerOAuthRoutes(app);

// Stateless mode: a fresh McpServer + transport per request. Simple to run,
// scales horizontally, and needs no session storage — fine for a tool-call
// style connector like this one (no server-initiated streaming needed).
app.post("/mcp", requireAuth, async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// No sessions in stateless mode, so GET (server->client stream) and DELETE
// (session teardown) aren't applicable.
app.get("/mcp", requireAuth, (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this connector runs in stateless mode." },
    id: null,
  });
});
app.delete("/mcp", requireAuth, (_req, res) => res.status(405).end());

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`discord-connector MCP server listening on :${port} (POST /mcp)`);
  if (!process.env.CONNECTOR_API_KEY) {
    console.warn(
      "WARNING: CONNECTOR_API_KEY is not set — /mcp is unauthenticated. " +
        "Set it before exposing this server publicly."
    );
  }

  // Start the (sometimes slow, observed up to ~200s on a cold free-tier
  // host) Discord gateway login now rather than waiting for the first tool
  // call, so a request that arrives after the server's been up a while
  // finds an already-warm client instead of paying that latency itself.
  if (process.env.DISCORD_BOT_TOKEN) {
    getDiscordClient()
      .then(() => console.log("Discord client ready."))
      .catch((err) => console.error("Discord client failed to connect on startup:", err.message));
  }
});
