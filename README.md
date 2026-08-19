# discord-connector

A remote MCP connector that gives Claude access to Discord community
management: creating/reorganizing channels, editing channel settings (topic,
slowmode, NSFW), managing permission overwrites, locking channels during
moderation, and managing roles.

It's a small Node/Express server exposing a single [Streamable HTTP MCP
endpoint](https://modelcontextprotocol.io/) (`POST /mcp`) backed by
[discord.js](https://discord.js.org/). You deploy it somewhere reachable over
HTTPS, then add it to Claude as a **custom connector** by URL.

## 1. Create a Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and create a new application.
2. Under **Bot**, click **Add Bot**, then **Reset Token** and copy the token.
3. Still under **Bot**, enable the **Server Members Intent**.
4. Under **OAuth2 → URL Generator**, select scope `bot`, and permissions:
   `Manage Channels`, `Manage Roles`, `View Channels`. Open the generated URL
   to invite the bot to your server.
5. In your server's role list, drag the bot's role **above** any roles you
   want it to be able to manage.

## 2. Configure and run the connector

```bash
cp .env.example .env
# edit .env:
#   DISCORD_BOT_TOKEN   - the bot token from step 1
#   CONNECTOR_API_KEY   - generate with `openssl rand -hex 32`; required
#                          before exposing this server publicly
#   PORT                - defaults to 3000
npm install
npm start
```

This starts an HTTP server with:

- `POST /mcp` — the MCP endpoint. Requires `Authorization: Bearer <CONNECTOR_API_KEY>`
  once `CONNECTOR_API_KEY` is set (it runs unauthenticated only if you leave
  that unset, which is fine for local testing, never for a public deploy).
- `GET /healthz` — plain liveness check, no auth.

The server is **stateless**: every MCP request spins up a fresh server
instance internally, so it scales horizontally and needs no session store or
sticky routing.

## 3. Deploy it

Any host that can run a long-lived Node process behind HTTPS works — e.g.
Fly.io, Render, Railway, a VPS behind a reverse proxy with TLS. Set
`DISCORD_BOT_TOKEN` and `CONNECTOR_API_KEY` as environment/secret variables
on that host; don't bake them into the image.

## 4. Add it to Claude

In Claude (claude.ai Settings → Connectors, or Claude Code's connector
config), add a custom connector:

- **URL**: `https://<your-host>/mcp`
- **Auth**: send `Authorization: Bearer <CONNECTOR_API_KEY>` as a custom
  header (exact UI depends on where you're adding it).

Once connected, Claude has access to the `discord_*` tools below.

## Available tools

| Tool | Purpose |
|---|---|
| `discord_list_guilds` | List servers the bot is in |
| `discord_list_channels` | List channels/categories in a server |
| `discord_create_channel` | Create a text/voice/category/announcement/forum/stage channel |
| `discord_update_channel` | Rename, retopic, set slowmode/NSFW, move/reorder a channel |
| `discord_delete_channel` | Delete a channel |
| `discord_list_roles` | List roles and their permissions |
| `discord_create_role` | Create a role |
| `discord_update_role` | Edit a role's name/color/permissions |
| `discord_set_channel_permission` | Set an allow/deny permission overwrite for a role/user on a channel |
| `discord_set_channel_lock` | Fast lock/unlock a channel for @everyone |

## Notes

- The bot only needs `Manage Channels` and `Manage Roles` for the tasks above
  — avoid granting `Administrator`.
- `CONNECTOR_API_KEY` is a single shared secret, not per-user OAuth — anyone
  holding it can act as the Discord bot through this connector. Treat it like
  a credential (rotate it if it leaks, don't log it, don't commit `.env`).
