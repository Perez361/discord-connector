import { z } from "zod";
import { ChannelType, PermissionsBitField } from "discord.js";
import { getGuild } from "../discordClient.js";

const CHANNEL_TYPE_MAP = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
};

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function summarizeChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: Object.keys(CHANNEL_TYPE_MAP).find(
      (key) => CHANNEL_TYPE_MAP[key] === channel.type
    ) || channel.type,
    parentId: channel.parentId ?? null,
    topic: "topic" in channel ? channel.topic ?? null : undefined,
    nsfw: "nsfw" in channel ? channel.nsfw : undefined,
    rateLimitPerUser: "rateLimitPerUser" in channel ? channel.rateLimitPerUser : undefined,
    position: channel.position,
  };
}

/** Resolves a role/user mention like "@everyone", a role name, or a raw snowflake ID to an overwrite target ID. */
async function resolveOverwriteTarget(guild, target) {
  if (target === "@everyone") return guild.id;
  if (/^\d+$/.test(target)) return target;
  const role = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === target.toLowerCase()
  );
  if (role) return role.id;
  throw new Error(`Could not resolve permission target "${target}" to a role or ID.`);
}

export function registerChannelTools(server) {
  server.tool(
    "discord_list_channels",
    "List all channels (and categories) in a Discord server, with their type, topic, slowmode, and category.",
    { guildId: z.string().describe("The Discord server (guild) ID") },
    async ({ guildId }) => {
      const guild = await getGuild(guildId);
      const channels = await guild.channels.fetch();
      const list = [...channels.values()]
        .filter(Boolean)
        .sort((a, b) => a.position - b.position)
        .map(summarizeChannel);
      return ok(list);
    }
  );

  server.tool(
    "discord_create_channel",
    "Create a new channel (text, voice, announcement, forum, stage, or category) in a Discord server.",
    {
      guildId: z.string().describe("The Discord server (guild) ID"),
      name: z.string().describe("Channel name"),
      type: z
        .enum(["text", "voice", "category", "announcement", "forum", "stage"])
        .default("text"),
      parentId: z
        .string()
        .optional()
        .describe("Category ID to nest this channel under"),
      topic: z.string().optional().describe("Channel topic (text/announcement channels)"),
      nsfw: z.boolean().optional(),
    },
    async ({ guildId, name, type, parentId, topic, nsfw }) => {
      const guild = await getGuild(guildId);
      const channel = await guild.channels.create({
        name,
        type: CHANNEL_TYPE_MAP[type],
        parent: parentId,
        topic,
        nsfw,
      });
      return ok(summarizeChannel(channel));
    }
  );

  server.tool(
    "discord_update_channel",
    "Update settings on an existing channel: rename it, change its topic, slowmode, NSFW flag, or move it to a different category.",
    {
      guildId: z.string(),
      channelId: z.string(),
      name: z.string().optional(),
      topic: z.string().optional(),
      nsfw: z.boolean().optional(),
      rateLimitPerUser: z
        .number()
        .int()
        .min(0)
        .max(21600)
        .optional()
        .describe("Slowmode in seconds (0 disables it, max 21600 / 6 hours)"),
      parentId: z.string().optional().describe("Move to this category ID"),
      position: z.number().int().min(0).optional(),
    },
    async ({ guildId, channelId, ...updates }) => {
      const guild = await getGuild(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel) throw new Error(`Channel ${channelId} not found in guild ${guildId}`);
      const payload = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      const updated = await channel.edit(payload);
      return ok(summarizeChannel(updated));
    }
  );

  server.tool(
    "discord_delete_channel",
    "Permanently delete a channel from a Discord server. This cannot be undone.",
    {
      guildId: z.string(),
      channelId: z.string(),
      reason: z.string().optional(),
    },
    async ({ guildId, channelId, reason }) => {
      const guild = await getGuild(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel) throw new Error(`Channel ${channelId} not found in guild ${guildId}`);
      const name = channel.name;
      await channel.delete(reason);
      return ok({ deleted: true, channelId, name });
    }
  );

  server.tool(
    "discord_set_channel_permission",
    "Set an allow/deny permission overwrite for a role or user on a specific channel (e.g. lock a channel by denying SendMessages for @everyone).",
    {
      guildId: z.string(),
      channelId: z.string(),
      target: z
        .string()
        .describe('Role name, "@everyone", or a raw role/user snowflake ID'),
      allow: z
        .array(z.string())
        .optional()
        .describe('Permission flag names to allow, e.g. ["SendMessages", "ViewChannel"]'),
      deny: z
        .array(z.string())
        .optional()
        .describe('Permission flag names to deny, e.g. ["SendMessages"]'),
    },
    async ({ guildId, channelId, target, allow = [], deny = [] }) => {
      const guild = await getGuild(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel) throw new Error(`Channel ${channelId} not found in guild ${guildId}`);
      const targetId = await resolveOverwriteTarget(guild, target);

      const allowFlags = Object.fromEntries(allow.map((flag) => [flag, true]));
      const denyFlags = Object.fromEntries(deny.map((flag) => [flag, false]));
      const missing = [...allow, ...deny].filter(
        (flag) => !(flag in PermissionsBitField.Flags)
      );
      if (missing.length) {
        throw new Error(
          `Unknown permission flag(s): ${missing.join(", ")}. See discord.js PermissionsBitField.Flags for valid names.`
        );
      }

      await channel.permissionOverwrites.edit(targetId, { ...allowFlags, ...denyFlags });
      const overwrite = channel.permissionOverwrites.cache.get(targetId);
      return ok({
        channelId,
        target: targetId,
        allow: overwrite?.allow.toArray() ?? [],
        deny: overwrite?.deny.toArray() ?? [],
      });
    }
  );

  server.tool(
    "discord_set_channel_lock",
    "Quickly lock or unlock a text channel for @everyone by denying/allowing the SendMessages permission. A fast path for moderation.",
    {
      guildId: z.string(),
      channelId: z.string(),
      locked: z.boolean().describe("true to lock (prevent @everyone from sending messages), false to unlock"),
    },
    async ({ guildId, channelId, locked }) => {
      const guild = await getGuild(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel) throw new Error(`Channel ${channelId} not found in guild ${guildId}`);
      await channel.permissionOverwrites.edit(guild.id, {
        SendMessages: locked ? false : null,
      });
      return ok({ channelId, locked });
    }
  );
}
