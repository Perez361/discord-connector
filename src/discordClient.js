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

  // Without a timeout, a gateway connection that never fires "ready" (bad
  // token, network hiccup, Discord-side issue) hangs the request forever
  // with no error ever thrown — the caller just sees an open connection
  // that never resolves. Race it against a generous timeout — a cold start
  // on a free-tier host plus Discord's own gateway handshake has been
  // observed taking upwards of 200s, so this needs real headroom, not just
  // enough to catch a stuck connection eventually — and on any failure
  // clear the cached promise so the next call gets a fresh attempt instead
  // of being stuck replaying the same rejection until the process restarts.
  clientPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out connecting to Discord's gateway after 5 minutes. Check DISCORD_BOT_TOKEN is valid."));
    }, 5 * 60_000);

    client.once("ready", () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    client.login(token).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  }).catch((err) => {
    clientPromise = null;
    throw err;
  });

  return clientPromise;
}

export async function getGuild(guildId) {
  const client = await getDiscordClient();
  const guild = await client.guilds.fetch(guildId);
  return guild;
}
