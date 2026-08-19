# discord-connector

A Claude Code plugin that connects Claude to a Discord server so it can help
with community management: creating/reorganizing channels, editing channel
settings (topic, slowmode, NSFW), managing permission overwrites, locking
channels during moderation, and managing roles.

It works as a local MCP server (`src/index.js`) built on
[discord.js](https://discord.js.org/), plus a skill
(`skills/discord-community-management`) that teaches Claude how to use the
tools responsibly (confirm before destructive changes, resolve names to IDs
first, etc).

## 1. Create a Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   and create a new application.
2. Under **Bot**, click **Add Bot**, then **Reset Token** and copy the token.
3. Still under **Bot**, enable the **Server Members Intent** (used to fetch
   member counts / role info).
4. Under **OAuth2 → URL Generator**, select scope `bot`, and permissions:
   `Manage Channels`, `Manage Roles`, `View Channels`. Copy the generated URL
   and open it to invite the bot to your server.
5. In your server's role list, drag the bot's role **above** any roles you
   want it to be able to manage — Discord won't let a bot edit/assign a role
   positioned above its own.

## 2. Configure the plugin

```bash
cp .env.example .env
# edit .env and paste your bot token into DISCORD_BOT_TOKEN
npm install
```

`DISCORD_BOT_TOKEN` needs to be available in the environment Claude Code runs
the MCP server in (either export it, or use your Claude Code plugin
marketplace/env config to inject it — see `.mcp.json`).

## 3. Install into Claude Code

Point Claude Code at this directory as a local plugin (or publish it to a
marketplace and install by name). Once installed, the `discord` MCP server
starts automatically and exposes tools prefixed `discord_*`.

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

- The bot only needs `Manage Channels` and `Manage Roles` for the tasks above —
  avoid granting `Administrator`.
- All destructive actions (deleting channels, revoking access) are left to
  Claude's judgement to confirm with you first, per the bundled skill.
