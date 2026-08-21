// Auto-grants a "verified" role once a member has both reacted to the rules
// message and posted in the introductions channel. Configured entirely via
// env vars so the connector stays generic — set all four to enable it.
//
// State (who's done which step) lives in memory only, same tradeoff as the
// OAuth tokens: a process restart forgets in-flight progress. To limit the
// blast radius of that, initAutoVerify() reconciles from Discord's own
// history at startup (rules message reactions + recent intro messages)
// before relying on live events going forward.

const state = new Map(); // guildId -> Map<userId, { rules: boolean, intro: boolean, granted: boolean }>

function getUserState(guildId, userId) {
  if (!state.has(guildId)) state.set(guildId, new Map());
  const guildState = state.get(guildId);
  if (!guildState.has(userId)) guildState.set(userId, { rules: false, intro: false, granted: false });
  return guildState.get(userId);
}

export async function initAutoVerify(client) {
  const guildId = process.env.AUTO_VERIFY_GUILD_ID;
  const rulesChannelId = process.env.AUTO_VERIFY_RULES_CHANNEL_ID;
  const introChannelId = process.env.AUTO_VERIFY_INTRO_CHANNEL_ID;
  const roleId = process.env.AUTO_VERIFY_ROLE_ID;
  const emoji = process.env.AUTO_VERIFY_EMOJI || "✅";

  if (!guildId || !rulesChannelId || !introChannelId || !roleId) {
    console.log(
      "Auto-verify not configured (set AUTO_VERIFY_GUILD_ID / AUTO_VERIFY_RULES_CHANNEL_ID / " +
        "AUTO_VERIFY_INTRO_CHANNEL_ID / AUTO_VERIFY_ROLE_ID to enable)."
    );
    return;
  }

  async function grantIfComplete(userId) {
    const s = getUserState(guildId, userId);
    if (s.granted || !(s.rules && s.intro)) return;
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (member.roles.cache.has(roleId)) {
        s.granted = true;
        return;
      }
      await member.roles.add(roleId);
      s.granted = true;
      console.log(`Auto-verify: granted role to ${member.user.username} (${userId})`);
    } catch (err) {
      console.error(`Auto-verify: failed to grant role to ${userId}:`, err.message);
    }
  }

  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      if (user.bot) return;
      if (reaction.partial) await reaction.fetch();
      if (reaction.message.partial) await reaction.message.fetch();
      if (reaction.message.channelId !== rulesChannelId) return;
      if (reaction.emoji.name !== emoji) return;
      getUserState(guildId, user.id).rules = true;
      await grantIfComplete(user.id);
    } catch (err) {
      console.error("Auto-verify reaction handler error:", err.message);
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;
      if (message.channelId !== introChannelId) return;
      getUserState(guildId, message.author.id).intro = true;
      await grantIfComplete(message.author.id);
    } catch (err) {
      console.error("Auto-verify message handler error:", err.message);
    }
  });

  console.log(`Auto-verify listeners registered for guild ${guildId} -> role ${roleId}.`);

  try {
    const guild = await client.guilds.fetch(guildId);
    const rulesChannel = await guild.channels.fetch(rulesChannelId);
    const introChannel = await guild.channels.fetch(introChannelId);

    const pinned = await rulesChannel.messages.fetchPinned();
    for (const msg of pinned.values()) {
      let reaction = msg.reactions.cache.find((r) => r.emoji.name === emoji);
      if (!reaction) continue;
      if (reaction.partial) reaction = await reaction.fetch();
      const users = await reaction.users.fetch();
      for (const u of users.values()) {
        if (u.bot) continue;
        getUserState(guildId, u.id).rules = true;
      }
    }

    const recentIntros = await introChannel.messages.fetch({ limit: 100 });
    for (const msg of recentIntros.values()) {
      if (msg.author.bot) continue;
      getUserState(guildId, msg.author.id).intro = true;
    }

    const candidates = [...(state.get(guildId)?.keys() ?? [])];
    for (const userId of candidates) {
      await grantIfComplete(userId);
    }
    console.log(`Auto-verify: reconciled ${candidates.length} member(s) from history on startup.`);
  } catch (err) {
    console.error("Auto-verify startup reconciliation failed:", err.message);
  }
}
