/**
 * GET /api/slack/users
 *
 * Returns a filtered list of real (non-bot, non-deleted) Slack workspace
 * members AND channels for the Missive sidebar picker.
 *
 * Required env var:  SLACK_BOT_TOKEN
 * Slack scopes:      users:read, channels:read, groups:read
 */

const { WebClient } = require("@slack/web-api");

module.exports = async function handler(req, res) {
  // ── CORS pre-flight ───────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ── Validate token ────────────────────────────────────────────────
  // Use SLACK_USER_TOKEN to fetch channels (allows private channels)
  // Fallback to SLACK_BOT_TOKEN for members list if needed
  const userToken = process.env.SLACK_USER_TOKEN;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const token = userToken || botToken;

  if (!token) {
    console.error("No Slack token configured (SLACK_USER_TOKEN or SLACK_BOT_TOKEN)");
    return res.status(500).json({ ok: false, error: "Server misconfiguration" });
  }

  try {
    const slack = new WebClient(token);

    // 1. Fetch human members
    const members = [];
    let userCursor;
    do {
      const page = await slack.users.list({
        limit: 200,
        ...(userCursor ? { cursor: userCursor } : {}),
      });

      if (!page.ok) throw new Error(page.error || "Slack API error (users)");

      const humans = (page.members || []).filter(
        (u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT"
      );

      members.push(
        ...humans.map((u) => ({
          id: u.id,
          name: u.real_name || u.name,
          displayName: u.profile?.display_name || u.real_name || u.name,
          avatar: u.profile?.image_48 || "",
          email: u.profile?.email || "",
        }))
      );
      userCursor = page.response_metadata?.next_cursor;
    } while (userCursor);

    members.sort((a, b) => a.displayName.localeCompare(b.displayName));

    // 2. Fetch channels (try public+private, fall back to public only)
    const channels = [];
    let channelTypes = "public_channel,private_channel";
    try {
      // Test if token has groups:read scope by fetching one private channel
      await slack.conversations.list({ limit: 1, types: "private_channel" });
    } catch (scopeErr) {
      // Token lacks groups:read — fall back to public channels only
      console.warn("groups:read scope not available, fetching public channels only");
      channelTypes = "public_channel";
    }

    let channelCursor;
    do {
      const page = await slack.conversations.list({
        limit: 200,
        types: channelTypes,
        ...(channelCursor ? { cursor: channelCursor } : {}),
      });

      if (!page.ok) throw new Error(page.error || "Slack API error (channels)");

      channels.push(
        ...(page.channels || []).map((c) => ({
          id: c.id,
          name: c.name,
          isPrivate: c.is_private || false,
        }))
      );
      channelCursor = page.response_metadata?.next_cursor;
    } while (channelCursor);

    channels.sort((a, b) => a.name.localeCompare(b.name));

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ ok: true, members, channels });
  } catch (err) {
    console.error("Error fetching Slack data:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
