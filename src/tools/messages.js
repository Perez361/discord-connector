import { z } from "zod";
import { getGuild } from "../discordClient.js";

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function registerMessageTools(server) {
  server.tool(
    "discord_send_message",
    "Post a message to a text channel. Discord messages are capped at 2000 characters — split longer content into multiple calls. Optionally pin it immediately.",
    {
      guildId: z.string(),
      channelId: z.string(),
      content: z.string().max(2000),
      pin: z.boolean().optional().describe("Pin the message immediately after sending"),
    },
    async ({ guildId, channelId, content, pin }) => {
      const guild = await getGuild(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${channelId} is not a text channel in guild ${guildId}`);
      }
      const message = await channel.send(content);
      if (pin) await message.pin();
      return ok({ messageId: message.id, channelId, pinned: !!pin });
    }
  );

  server.tool(
    "discord_pin_message",
    "Pin an existing message in a channel.",
    {
      guildId: z.string(),
      channelId: z.string(),
      messageId: z.string(),
    },
    async ({ guildId, channelId, messageId }) => {
      const guild = await getGuild(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${channelId} is not a text channel in guild ${guildId}`);
      }
      const message = await channel.messages.fetch(messageId);
      await message.pin();
      return ok({ messageId, channelId, pinned: true });
    }
  );
}
