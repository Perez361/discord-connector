// Auto-grants a "verified" role once a member reacts to the rules message
// with the configured emoji. Configured entirely via env vars so the
// connector stays generic — set all three (GUILD_ID, RULES_CHANNEL_ID,
// ROLE_ID) to enable it.
//
// No in-memory state: every grant checks the member's live role list on
// Discord first, so a process restart loses nothing — there's only one
// condition to satisfy, and Discord itself is the source of truth for it.

export async function initAutoVerify(client) {
  const guildId = process.env.AUTO_VERIFY_GUILD_ID;
  const rulesChannelId = process.env.AUTO_VERIFY_RULES_CHANNEL_ID;
  const roleId = process.env.AUTO_VERIFY_ROLE_ID;
  const emoji = process.env.AUTO_VERIFY_EMOJI || "✅";

  if (!guildId || !rulesChannelId || !roleId) {
    console.log(
      "Auto-verify not configured (set AUTO_VERIFY_GUILD_ID / AUTO_VERIFY_RULES_CHANNEL_ID / " +
        "AUTO_VERIFY_ROLE_ID to enable)."
    );
    return;
  }

  async function grant(userId) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (member.roles.cache.has(roleId)) return;
      await member.roles.add(roleId);
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
      await grant(user.id);
    } catch (err) {
      console.error("Auto-verify reaction handler error:", err.message);
    }
  });

  console.log(`Auto-verify listener registered for guild ${guildId} -> role ${roleId}.`);

  // Reconcile from history on startup: anyone who already reacted to a
  // pinned rules message before this process started (or during downtime)
  // gets the role now instead of waiting on their next reaction.
  try {
    const guild = await client.guilds.fetch(guildId);
    const rulesChannel = await guild.channels.fetch(rulesChannelId);
    const pinned = await rulesChannel.messages.fetchPinned();

    let reconciled = 0;
    for (const msg of pinned.values()) {
      let reaction = msg.reactions.cache.find((r) => r.emoji.name === emoji);
      if (!reaction) continue;
      if (reaction.partial) reaction = await reaction.fetch();
      const users = await reaction.users.fetch();
      for (const u of users.values()) {
        if (u.bot) continue;
        await grant(u.id);
        reconciled++;
      }
    }
    console.log(`Auto-verify: reconciled ${reconciled} member(s) from history on startup.`);
  } catch (err) {
    console.error("Auto-verify startup reconciliation failed:", err.message);
  }
}
