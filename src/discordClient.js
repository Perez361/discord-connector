import { Client, GatewayIntentBits } from "discord.js";

let clientPromise = null;

/**
 * Lazily logs in a single shared discord.js Client on first use.
 * The bot token is only required once a tool actually needs Discord access,
 * so the MCP server can still start (and list tools) without one configured.
 */
export function getDiscordClient() {
  if (clientPromise) return clientPromise;

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error(
      "DISCORD_BOT_TOKEN is not set. Add it to your environment (see README.md) " +
        "before running Discord tools."
    );
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  clientPromise = client
    .login(token)
    .then(() => new Promise((resolve) => client.once("ready", () => resolve(client))));

  return clientPromise;
}

export async function getGuild(guildId) {
  const client = await getDiscordClient();
  const guild = await client.guilds.fetch(guildId);
  return guild;
}
