import { z } from "zod";
import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel } from "discord.js";
import { getGuild } from "../discordClient.js";

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function summarizeEvent(e) {
  return {
    id: e.id,
    name: e.name,
    description: e.description,
    scheduledStartAt: e.scheduledStartAt,
    scheduledEndAt: e.scheduledEndAt,
    status: e.status,
    channelId: e.channelId,
  };
}

export function registerEventTools(server) {
  server.tool(
    "discord_create_event",
    "Create a Discord Server Event — shows in the server's Events tab, members can RSVP and get automatic reminders across time zones.",
    {
      guildId: z.string(),
      name: z.string(),
      description: z.string().optional(),
      startTime: z.string().describe("ISO 8601 datetime, e.g. 2026-08-30T18:00:00Z"),
      endTime: z.string().optional().describe("ISO 8601 datetime"),
      channelId: z
        .string()
        .optional()
        .describe("Voice channel ID to host it in; omit for an external/location-based event"),
      location: z.string().optional().describe("Required if channelId is omitted"),
    },
    async ({ guildId, name, description, startTime, endTime, channelId, location }) => {
      const guild = await getGuild(guildId);
      const entityType = channelId
        ? GuildScheduledEventEntityType.Voice
        : GuildScheduledEventEntityType.External;
      const event = await guild.scheduledEvents.create({
        name,
        description,
        scheduledStartTime: new Date(startTime),
        scheduledEndTime: endTime ? new Date(endTime) : undefined,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType,
        channel: channelId,
        entityMetadata:
          entityType === GuildScheduledEventEntityType.External
            ? { location: location ?? "TBD" }
            : undefined,
      });
      return ok(summarizeEvent(event));
    }
  );

  server.tool(
    "discord_list_events",
    "List upcoming/active Server Events.",
    { guildId: z.string() },
    async ({ guildId }) => {
      const guild = await getGuild(guildId);
      const events = await guild.scheduledEvents.fetch();
      return ok([...events.values()].map(summarizeEvent));
    }
  );
}
