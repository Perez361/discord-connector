// Receives a POST from a Google Apps Script trigger bound to the leaderboard
// Sheet every time it's edited, and posts/edits Discord messages with the
// current group standings + third-place ranking. No Google credentials live
// here — the Sheet already computes the tables via formulas, Apps Script
// just reads the cell values and pushes them over.
//
// Each table is upserted, not reposted: the handler looks for an existing
// message from the bot whose content starts with that table's heading and
// edits it in place, so repeated edits to the same match don't spam the
// channel with a new message every time.

import { getDiscordClient } from "../discordClient.js";

const COLS = ["Rank", "Player", "P", "W", "L", "GF", "GA", "GD", "Pts"];
const WIDTHS = [4, 18, 3, 3, 3, 4, 4, 4, 4];

function pad(value, width) {
  const str = String(value ?? "");
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}

function renderTable(rows) {
  const header = COLS.map((c, i) => pad(c, WIDTHS[i])).join(" ");
  const sep = WIDTHS.map((w) => "-".repeat(w)).join(" ");
  const body = rows.map((r) =>
    [r.rank, r.player, r.played, r.won, r.lost, r.gf, r.ga, r.gd, r.points]
      .map((v, i) => pad(v, WIDTHS[i]))
      .join(" ")
  );
  return ["```", header, sep, ...body, "```"].join("\n");
}

function buildSections(payload) {
  const sections = [];
  for (const g of payload.groups || []) {
    const heading = `## Group ${g.group} — Standings`;
    sections.push({ heading, content: `${heading}\n${renderTable(g.rows || [])}` });
  }
  if (Array.isArray(payload.thirdPlace) && payload.thirdPlace.length > 0) {
    const heading = `## Best Third-Place Ranking`;
    const rows = payload.thirdPlace.map((r) => ({ ...r, player: `${r.player} (${r.group})` }));
    sections.push({ heading, content: `${heading}\n${renderTable(rows)}` });
  }
  return sections;
}

async function upsertSection(channelId, botUserId, heading, content) {
  const client = await getDiscordClient();
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const recent = await channel.messages.fetch({ limit: 50 });
  const existing = recent.find((m) => m.author.id === botUserId && m.content.startsWith(heading));

  if (existing) {
    await existing.edit(content);
    return { messageId: existing.id, action: "updated" };
  }
  const sent = await channel.send(content);
  return { messageId: sent.id, action: "created" };
}

export function registerStandingsWebhook(app) {
  app.post("/webhooks/standings", async (req, res) => {
    const secret = process.env.STANDINGS_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "STANDINGS_WEBHOOK_SECRET is not configured on the server." });
    }
    if (req.headers["x-webhook-secret"] !== secret) {
      return res.status(401).json({ error: "Invalid or missing X-Webhook-Secret header." });
    }

    const channelId = process.env.STANDINGS_CHANNEL_ID;
    if (!channelId) {
      return res.status(503).json({ error: "STANDINGS_CHANNEL_ID is not configured on the server." });
    }

    try {
      const sections = buildSections(req.body || {});
      if (sections.length === 0) {
        return res.status(400).json({ error: "Payload had no groups[] or thirdPlace[] data." });
      }
      const client = await getDiscordClient();
      const results = [];
      for (const s of sections) {
        results.push(await upsertSection(channelId, client.user.id, s.heading, s.content));
      }
      res.json({ ok: true, results });
    } catch (err) {
      console.error("Standings webhook failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
