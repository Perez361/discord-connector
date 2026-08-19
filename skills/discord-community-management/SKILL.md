---
name: discord-community-management
description: Use when the user asks Claude to manage a Discord server/community through the discord-connector plugin — creating or reorganizing channels, adjusting channel settings (topic, slowmode, NSFW), setting permission overwrites, locking/unlocking channels for moderation, or managing roles.
---

# Discord Community Management

This skill guides how to use the `discord-connector` MCP tools (`discord_*`) safely
and effectively when a user asks for help administering a Discord server.

## Before making changes

1. Call `discord_list_guilds` if the user hasn't given a guild ID, and confirm which
   server they mean before acting — the bot may be in more than one.
2. Call `discord_list_channels` and/or `discord_list_roles` to see current state
   before creating, renaming, or deleting anything. Don't guess IDs.
3. For any **destructive** action (`discord_delete_channel`, permission changes that
   remove access, role permission grants), state exactly what will change and get
   the user's confirmation first, unless they've already been explicit about it.

## Common tasks

- **Reorganizing channels**: use `discord_create_channel` with `type: "category"`
  first, then create/move channels into it via `parentId`.
- **Slowmode / rate limiting a busy channel**: `discord_update_channel` with
  `rateLimitPerUser` (seconds, 0 disables).
- **Locking a channel during moderation**: prefer `discord_set_channel_lock` over
  hand-building permission overwrites — it's the safe, reversible fast path.
- **Fine-grained permissions** (e.g. hide a channel from a role, allow only mods to
  post in announcements): `discord_set_channel_permission` with `allow`/`deny`
  arrays of discord.js permission flag names (e.g. `SendMessages`, `ViewChannel`,
  `ManageMessages`). Resolve role names via `discord_list_roles` first if unsure.
- **New role for a sub-community**: `discord_create_role`, then apply it with
  `discord_set_channel_permission` on the relevant channels.

## Guardrails

- Never grant `Administrator` or other broad/destructive permissions to a role
  unless the user explicitly asks for that specific permission by name.
- `@everyone` permission changes affect every member — call these out clearly.
- If a tool call fails because the bot lacks a permission (Discord returns a 403),
  tell the user which permission the bot's role is missing rather than retrying
  blindly — the fix is usually granting the bot role `Manage Channels` and/or
  `Manage Roles`, and ensuring the bot's role sits above roles it needs to manage.
