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

**claude.ai → Settings → Connectors → Add custom connector**: paste just the
URL, `https://<your-host>/mcp`, and click Add. That dialog only takes a URL
(plus optional OAuth client fields) — no header field — so the server
implements the standard MCP OAuth flow itself: Claude discovers the
`/.well-known/oauth-*` endpoints, dynamically registers itself as a client,
and redirects you to a login page on your own server where you enter your
`CONNECTOR_API_KEY` once to authorize it. From then on Claude holds an
issued access token (auto-refreshed), not your raw key.

**Claude Code's `.mcp.json`**, or anything else that lets you set a raw
header, can skip OAuth entirely and send the static key directly:

```json
{
  "mcpServers": {
    "discord": {
      "type": "http",
      "url": "https://<your-host>/mcp",
      "headers": { "Authorization": "Bearer <CONNECTOR_API_KEY>" }
    }
  }
}
```

Either way, once connected Claude has access to the `discord_*` tools below.

Set `PUBLIC_URL` (e.g. `https://discord-connector.onrender.com`) as an env
var on your host — the OAuth endpoints need to advertise absolute URLs, and
while the server will guess one from request headers if it's unset, an
explicit value is more reliable behind some proxies.

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
| `discord_send_message` | Post a message to a text channel, optionally pinning it |
| `discord_pin_message` | Pin an existing message |
| `discord_add_reaction` | Add a reaction emoji to a message |
| `discord_purge_messages` | Bulk-delete recent messages in a channel |
| `discord_set_role_position` | Change a role's position in the hierarchy |
| `discord_list_members` | List server members and their roles |
| `discord_assign_role` | Add a role to a member |
| `discord_remove_role` | Remove a role from a member |
| `discord_kick_member` | Kick a member |
| `discord_ban_member` | Ban a member, optionally deleting recent messages |
| `discord_timeout_member` | Temporarily mute/timeout a member |
| `discord_remove_timeout` | Clear an active timeout early |
| `discord_create_event` | Create a Discord Server Event (RSVP + reminders) |
| `discord_list_events` | List upcoming/active Server Events |

## Auto-verify (optional)

A background listener — separate from the `discord_*` tools, always running
on the same live connection — that automatically grants a role once a member
reacts to your pinned rules message with the configured emoji. Set all three
env vars to enable it:

```
AUTO_VERIFY_GUILD_ID=<your server ID>
AUTO_VERIFY_RULES_CHANNEL_ID=<#rules channel ID>
AUTO_VERIFY_ROLE_ID=<role ID to grant, e.g. Community Member>
AUTO_VERIFY_EMOJI=✅   # optional, defaults to ✅
```

It reconciles from Discord's own history on every boot (existing reactions
on the pinned rules message) before relying on live events, so a restart
doesn't miss anyone who reacted while the process was down. No database —
every grant checks the member's live role list on Discord first, so there's
no in-memory progress to lose.

## Standings webhook (optional)

Lets an external caller push tournament standings into a Discord channel —
built for a Google Apps Script trigger on a leaderboard Sheet, so entering a
match result there updates the channel automatically with no manual step and
no Discord tool call needed. Separate from the OAuth-protected `/mcp`
endpoint: this one is a plain `POST /webhooks/standings` guarded by its own
shared secret.

`STANDINGS_WEBHOOK_SECRET` is required for the endpoint to respond at all.
Each channel ID is independent and optional — leave one unset to skip that
section of the payload:

```
STANDINGS_WEBHOOK_SECRET=<generate with: openssl rand -hex 24>
STANDINGS_CHANNEL_ID=<#channel ID for per-group standings + best third-place ranking>
OVERALL_CHANNEL_ID=<#channel ID for the all-players overall leaderboard, if you post one — often a different channel>
```

Expected request:

```
POST /webhooks/standings
X-Webhook-Secret: <STANDINGS_WEBHOOK_SECRET>
Content-Type: application/json

{
  "groups": [
    { "group": "A", "rows": [
      { "rank": 1, "player": "PlayerName", "played": 3, "won": 3, "lost": 0, "gf": 9, "ga": 2, "gd": 7, "points": 9 }
    ] }
  ],
  "thirdPlace": [
    { "rank": 1, "group": "A", "player": "PlayerName", "played": 3, "won": 2, "lost": 1, "gf": 6, "ga": 4, "gd": 2, "points": 7 }
  ],
  "overall": [
    { "rank": 1, "player": "PlayerName", "group": "A", "played": 3, "won": 3, "lost": 0, "gf": 9, "ga": 2, "gd": 7, "points": 9 }
  ]
}
```

For each group, the third-place ranking (if present), and the overall
leaderboard (if present) it posts one message as a monospace table under a
heading like `## Group A — Standings` or `## Overall Leaderboard`. On the
next call it looks for an existing bot message starting with that same
heading in the last 50 messages of the channel and **edits it in place**
instead of posting a new one — so repeated edits to the Sheet update the
same messages rather than spamming the channel. `groups`/`thirdPlace` post
to `STANDINGS_CHANNEL_ID`, `overall` posts to `OVERALL_CHANNEL_ID` — a
section is silently skipped (reported in the response as `skipped: true`)
if its channel ID isn't configured.

### Wiring it to the leaderboard Sheet

In the Sheet: **Extensions → Apps Script**, replace the contents with:

```javascript
const WEBHOOK_URL = "https://<your-host>/webhooks/standings";
const WEBHOOK_SECRET = "<same value as STANDINGS_WEBHOOK_SECRET>";

function readTable_(sheetName, headerMap) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idx = {};
  for (const key in headerMap) idx[key] = headers.indexOf(headerMap[key]);
  return values.slice(1)
    .filter((row) => row[idx.player])
    .map((row) => {
      const out = {};
      for (const key in idx) out[key] = row[idx[key]];
      return out;
    });
}

function sendStandingsUpdate() {
  const standings = readTable_("Standings", {
    group: "Group", rank: "Rank", player: "Player", played: "Played",
    won: "Won", lost: "Lost", gf: "GF", ga: "GA", gd: "GD", points: "Points",
  });

  const groupsMap = {};
  standings.forEach((row) => {
    if (!groupsMap[row.group]) groupsMap[row.group] = [];
    groupsMap[row.group].push(row);
  });
  const groups = Object.keys(groupsMap).sort().map((group) => ({
    group, rows: groupsMap[group].sort((a, b) => a.rank - b.rank),
  }));

  // Third-Place Ranking has a raw per-group helper block below the real
  // table (same sheet) — its rows have text like "A" where a number is
  // expected here, so filtering to numeric ranks drops them regardless of
  // how many groups you have, without hardcoding a row count.
  const thirdPlace = readTable_("Third-Place Ranking", {
    rank: "Rank", group: "Group", player: "Player", played: "Played",
    won: "Won", lost: "Lost", gf: "GF", ga: "GA", gd: "GD", points: "Points",
  }).filter((row) => typeof row.rank === "number").sort((a, b) => a.rank - b.rank);

  const overall = readTable_("Overall Leaderboard", {
    rank: "Rank", player: "Player", group: "Group", played: "Played",
    won: "Won", lost: "Lost", gf: "GF", ga: "GA", gd: "GD", points: "Points",
  }).sort((a, b) => a.rank - b.rank);

  const res = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    headers: { "X-Webhook-Secret": WEBHOOK_SECRET },
    payload: JSON.stringify({ groups, thirdPlace, overall }),
    muteHttpExceptions: true,
  });
  Logger.log(res.getContentText());
}

function onMatchResultsEdit(e) {
  if (e.range.getSheet().getName() !== "Match Results") return;
  sendStandingsUpdate();
}

// Run this once manually from the Apps Script editor (Run ▶ createTrigger)
// to install the installable trigger — a simple onEdit(e) can't make
// external HTTP calls, this is the one-time setup that grants it that.
function createTrigger() {
  ScriptApp.newTrigger("onMatchResultsEdit")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
}
```

Then: fill in `WEBHOOK_URL`/`WEBHOOK_SECRET`, save, select `createTrigger` in
the function dropdown and click **Run** once — Google will prompt you to
authorize the script (it needs to read the Sheet and call an external URL),
approve it, and you're done. From then on, editing any cell in `Match
Results` recomputes the formulas and pushes the refreshed standings to
Discord within a few seconds, with nothing for you to do by hand.

## Notes

- Discord only lets a role grant permissions the *granting* role itself
  holds — a bot role with just `Manage Channels`/`Manage Roles` will fail
  ("Missing Permissions") the moment it tries to configure a moderator role
  with things like `Kick Members` or `Ban Members`, and can get "Missing
  Access" errors on channels it can't itself see. In practice, granting the
  bot's role `Administrator` is the simplest way to avoid both — reasonable
  for a personal automation bot you control, less so if you'd hand this
  connector's key to people you don't fully trust.
- `CONNECTOR_API_KEY` is a single shared secret, not per-user OAuth — anyone
  holding it can act as the Discord bot through this connector. Treat it like
  a credential (rotate it if it leaks, don't log it, don't commit `.env`).
