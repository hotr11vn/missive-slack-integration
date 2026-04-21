/**
 * GET /api/slack/users
 *
 * Returns a filtered list of real (non-bot, non-deleted) Slack workspace
 * members AND channels for the Missive sidebar picker.
 *
 * Required env vars:  SLACK_BOT_TOKEN, SLACK_USER_TOKEN
 * Bot token scopes:   users:read
 * User token scopes:  channels:read, groups:read
 *
 * Using the user token for channels means ALL private channels the user
 * is a member of will appear — not just ones the bot was added to.
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

  // ── Validate tokens ───────────────────────────────────────────────
  // Bot token: used for users.list (needs users:read)
  // User token: used for conversations.list (sees all channels the user is in,
  //             including private — bot token only sees channels it was added to)
  const botToken = process.env.SLACK_BOT_TOKEN;
  const userToken = process.env.SLACK_USER_TOKEN;

  if (!botToken) {
    console.error("No SLACK_BOT_TOKEN configured");
    return res.status(500).json({ ok: false, error: "Server misconfiguration: SLACK_BOT_TOKEN missing" });
  }

  try {
    const slackBot = new WebClient(botToken);
    // Use user token for channels if available, otherwise fall back to bot token
    const slackChannels = userToken ? new WebClient(userToken) : slackBot;

    // 1. Fetch human members (bot token)
    const members = [];
    let userCursor;
    do {
      const page = await slackBot.users.list({
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

    // 2. Fetch channels (user token — sees all channels user is member of)
    // Try public + private first, fall back to public only if groups:read missing
    const channels = [];
    let channelTypes = "public_channel,private_channel";
    try {
      await slackChannels.conversations.list({ limit: 1, types: "private_channel" });
    } catch (scopeErr) {
      console.warn("groups:read scope not available on channel token, fetching public channels only");
      channelTypes = "public_channel";
    }

    let channelCursor;
    do {
      const page = await slackChannels.conversations.list({
        limit: 200,
        types: channelTypes,
        ...(channelCursor ? { cursor: channelCursor } : {}),
      });

      if (!page.ok) throw new Error(page.error || "Slack API error (channels)");

      channels.push(
        ...(page.channels || []).filter(c => !c.is_archived).map((c) => ({
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
