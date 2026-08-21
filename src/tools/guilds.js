import { z } from "zod";
import { PermissionsBitField } from "discord.js";
import { getDiscordClient, getGuild } from "../discordClient.js";

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function summarizeRole(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    position: role.position,
    mentionable: role.mentionable,
    hoist: role.hoist,
    permissions: role.permissions.toArray(),
  };
}

export function registerGuildTools(server) {
  server.tool(
    "discord_list_guilds",
    "List every Discord server (guild) the bot has been added to, with member counts.",
    {},
    async () => {
      const client = await getDiscordClient();
      const guilds = await client.guilds.fetch();
      const detailed = await Promise.all(
        [...guilds.values()].map(async (g) => {
          const full = await g.fetch();
          return { id: full.id, name: full.name, memberCount: full.memberCount };
        })
      );
      return ok(detailed);
    }
  );

  server.tool(
    "discord_list_roles",
    "List all roles in a Discord server, including their permissions and position in the hierarchy.",
    { guildId: z.string() },
    async ({ guildId }) => {
      const guild = await getGuild(guildId);
      const roles = await guild.roles.fetch();
      const list = [...roles.values()]
        .sort((a, b) => b.position - a.position)
        .map(summarizeRole);
      return ok(list);
    }
  );

  server.tool(
    "discord_create_role",
    "Create a new role in a Discord server with an optional color and permission set.",
    {
      guildId: z.string(),
      name: z.string(),
      color: z.string().optional().describe("Hex color, e.g. #5865F2"),
      hoist: z.boolean().optional().describe("Display members of this role separately in the sidebar"),
      mentionable: z.boolean().optional(),
      permissions: z
        .array(z.string())
        .optional()
        .describe('Permission flag names this role should have, e.g. ["ManageChannels"]'),
    },
    async ({ guildId, name, color, hoist, mentionable, permissions }) => {
      const guild = await getGuild(guildId);
      if (permissions?.length) {
        const missing = permissions.filter((flag) => !(flag in PermissionsBitField.Flags));
        if (missing.length) {
          throw new Error(`Unknown permission flag(s): ${missing.join(", ")}`);
        }
      }
      const role = await guild.roles.create({
        name,
        color,
        hoist,
        mentionable,
        permissions: permissions ?? [],
      });
      return ok(summarizeRole(role));
    }
  );

  server.tool(
    "discord_update_role",
    "Update an existing role's name, color, hoist/mentionable flags, or permission set.",
    {
      guildId: z.string(),
      roleId: z.string(),
      name: z.string().optional(),
      color: z.string().optional(),
      hoist: z.boolean().optional(),
      mentionable: z.boolean().optional(),
      permissions: z.array(z.string()).optional(),
    },
    async ({ guildId, roleId, ...updates }) => {
      const guild = await getGuild(guildId);
      const role = await guild.roles.fetch(roleId);
      if (!role) throw new Error(`Role ${roleId} not found in guild ${guildId}`);
      if (updates.permissions?.length) {
        const missing = updates.permissions.filter(
          (flag) => !(flag in PermissionsBitField.Flags)
        );
        if (missing.length) {
          throw new Error(`Unknown permission flag(s): ${missing.join(", ")}`);
        }
      }
      const payload = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      const updated = await role.edit(payload);
      return ok(summarizeRole(updated));
    }
  );

  server.tool(
    "discord_set_role_position",
    "Change a role's position in the hierarchy. Higher numbers rank above lower ones (position 1 is just above @everyone).",
    {
      guildId: z.string(),
      roleId: z.string(),
      position: z.number().int().min(1),
    },
    async ({ guildId, roleId, position }) => {
      const guild = await getGuild(guildId);
      const role = await guild.roles.fetch(roleId);
      if (!role) throw new Error(`Role ${roleId} not found in guild ${guildId}`);
      const updated = await role.setPosition(position);
      return ok(summarizeRole(updated));
    }
  );
}
