/**
 * POST /api/slack/send
 *
 * Opens a DM with the chosen Slack user or posts to a channel
 * using the SLACK_USER_TOKEN to send "as the user" (e.g. @davidhoang).
 *
 * Required env var:  SLACK_USER_TOKEN
 * Slack scopes:      im:write, chat:write, channels:read, groups:read
 */

const { WebClient } = require("@slack/web-api");

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Robustly strip HTML from an email body.
 */
function stripHtml(html) {
  if (!html) return "";

  let text = html;

  // 1. Remove entire <style>…</style> and <script>…</script> blocks
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");

  // 2. Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // 3. Convert block-level tags to newlines before stripping
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");

  // 4. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // 5. Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/");

  // 6. Collapse excessive whitespace / blank lines
  text = text.replace(/[ \t]+/g, " ");           // collapse horizontal whitespace
  text = text.replace(/\n[ \t]+/g, "\n");        // trim leading spaces on each line
  text = text.replace(/\n{3,}/g, "\n\n");        // max two consecutive newlines

  return text.trim();
}

/**
 * Truncate text to fit Slack's 3,000-char section limit.
 */
function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

// ── Main handler ─────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // ── CORS pre-flight ───────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ── Validate input ────────────────────────────────────────────────
  const { channelId, subject, from, to, body, date, missiveLink, isUser } = req.body;

  if (!channelId) {
    return res.status(400).json({ ok: false, error: "channelId is required" });
  }

  // ── Validate token ────────────────────────────────────────────────
  // Prefer SLACK_USER_TOKEN for sending "as user". Fallback to SLACK_BOT_TOKEN.
  const token = process.env.SLACK_USER_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("No Slack token configured (SLACK_USER_TOKEN or SLACK_BOT_TOKEN)");
    return res.status(500).json({ ok: false, error: "Server misconfiguration" });
  }

  try {
    const slack = new WebClient(token);

    // ── Target identification ─────────────────────────────────────────
    let targetChannelId = channelId;

    // If target is a user ID (starts with U or W), we must open a DM first
    if (isUser && (channelId.startsWith("U") || channelId.startsWith("W"))) {
      const openDm = await slack.conversations.open({ users: channelId });
      if (!openDm.ok) {
        throw new Error(openDm.error || "Could not open DM channel");
      }
      targetChannelId = openDm.channel.id;
    }

    // ── Message construction ──────────────────────────────────────────
    const cleanBody = stripHtml(body);
    const formattedDate = date ? new Date(date).toLocaleString() : "Unknown date";

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: truncate(subject || "No Subject", 3000),
          emoji: true,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*From:* ${from || "Unknown"} | *To:* ${to || "Unknown"} | *Date:* ${formattedDate}`,
          },
        ],
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: truncate(cleanBody || "_No message content_", 3000),
        },
      },
    ];

    // Add deep link button if available
    if (missiveLink) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View in Missive",
              emoji: true,
            },
            url: missiveLink,
            action_id: "view_in_missive",
          },
        ],
      });
    }

    // ── Send to Slack ─────────────────────────────────────────────────
    const result = await slack.chat.postMessage({
      channel: targetChannelId,
      text: `[Missive Email] ${subject}`, // Fallback text
      blocks: blocks,
    });

    if (!result.ok) {
      throw new Error(result.error || "Slack chat.postMessage failed");
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      ok: true,
      channel: result.channel,
      ts: result.ts,
    });

  } catch (err) {
    console.error("Error sending to Slack:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
