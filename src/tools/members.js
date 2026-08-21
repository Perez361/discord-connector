import { z } from "zod";
import { getGuild } from "../discordClient.js";

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function summarizeMember(member) {
  return {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    roles: member.roles.cache
      .filter((r) => r.id !== member.guild.id)
      .map((r) => ({ id: r.id, name: r.name })),
    joinedAt: member.joinedAt,
  };
}

export function registerMemberTools(server) {
  server.tool(
    "discord_list_members",
    "List members of a server with their roles. Requires the Server Members intent (already enabled for this bot).",
    {
      guildId: z.string(),
      limit: z.number().int().min(1).max(1000).optional().default(100),
    },
    async ({ guildId, limit }) => {
      const guild = await getGuild(guildId);
      const members = await guild.members.fetch();
      const list = [...members.values()].slice(0, limit).map(summarizeMember);
      return ok(list);
    }
  );

  server.tool(
    "discord_assign_role",
    "Add a role to a member.",
    { guildId: z.string(), userId: z.string(), roleId: z.string() },
    async ({ guildId, userId, roleId }) => {
      const guild = await getGuild(guildId);
      const member = await guild.members.fetch(userId);
      await member.roles.add(roleId);
      return ok({ userId, roleId, assigned: true });
    }
  );

  server.tool(
    "discord_remove_role",
    "Remove a role from a member.",
    { guildId: z.string(), userId: z.string(), roleId: z.string() },
    async ({ guildId, userId, roleId }) => {
      const guild = await getGuild(guildId);
      const member = await guild.members.fetch(userId);
      await member.roles.remove(roleId);
      return ok({ userId, roleId, removed: true });
    }
  );

  server.tool(
    "discord_kick_member",
    "Kick a member from the server. They can rejoin with a new invite.",
    { guildId: z.string(), userId: z.string(), reason: z.string().optional() },
    async ({ guildId, userId, reason }) => {
      const guild = await getGuild(guildId);
      const member = await guild.members.fetch(userId);
      const username = member.user.username;
      await member.kick(reason);
      return ok({ userId, username, kicked: true });
    }
  );

  server.tool(
    "discord_ban_member",
    "Ban a member from the server, optionally deleting their recent messages.",
    {
      guildId: z.string(),
      userId: z.string(),
      reason: z.string().optional(),
      deleteMessageSeconds: z
        .number()
        .int()
        .min(0)
        .max(604800)
        .optional()
        .describe("How much recent message history to also delete, up to 7 days (604800s)"),
    },
    async ({ guildId, userId, reason, deleteMessageSeconds }) => {
      const guild = await getGuild(guildId);
      await guild.members.ban(userId, { reason, deleteMessageSeconds });
      return ok({ userId, banned: true });
    }
  );

  server.tool(
    "discord_timeout_member",
    "Temporarily prevent a member from sending messages or speaking (Discord's built-in timeout).",
    {
      guildId: z.string(),
      userId: z.string(),
      durationMinutes: z.number().int().min(1).max(40320).describe("Max 28 days (40320 minutes)"),
      reason: z.string().optional(),
    },
    async ({ guildId, userId, durationMinutes, reason }) => {
      const guild = await getGuild(guildId);
      const member = await guild.members.fetch(userId);
      await member.timeout(durationMinutes * 60 * 1000, reason);
      return ok({ userId, timedOutForMinutes: durationMinutes });
    }
  );

  server.tool(
    "discord_remove_timeout",
    "Clear an active timeout on a member early.",
    { guildId: z.string(), userId: z.string() },
    async ({ guildId, userId }) => {
      const guild = await getGuild(guildId);
      const member = await guild.members.fetch(userId);
      await member.timeout(null);
      return ok({ userId, timeoutCleared: true });
    }
  );
}
