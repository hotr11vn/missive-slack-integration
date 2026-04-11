/**
 * POST /api/slack/send
 *
 * Opens a DM with the chosen Slack user and posts a rich Block Kit message
 * containing the email details forwarded from Missive.
 *
 * Required env var:  SLACK_BOT_TOKEN
 * Slack scopes:      im:write, chat:write
 *
 * Expected JSON body:
 * {
 *   "userId":        "U12345678",          // Slack user ID
 *   "subject":       "Re: Q3 Report",      // Email subject
 *   "from":          "Alice <a@b.com>",    // Sender
 *   "to":            "Bob <b@b.com>",       // Recipient(s)
 *   "body":          "Hi team, ...",        // Plain-text or mrkdwn body
 *   "date":          "2025-06-15T10:30:00Z",// ISO timestamp (optional)
 *   "missiveLink":   "https://mail.missiveapp.com/..." // deep link (optional)
 * }
 */

const { WebClient } = require("@slack/web-api");

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Truncate text to fit Slack's 3 000-char section limit, appending an
 * ellipsis when trimmed.
 */
function truncate(text, max = 2900) {
  if (!text) return "_No body content._";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n…_(truncated)_";
}

/**
 * Strip common HTML tags and decode basic entities so the email body
 * renders as readable plain text inside Slack.
 */
function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Build the Block Kit blocks array for the Slack message.
 */
function buildBlocks({ subject, from, to, body, date, missiveLink }) {
  const blocks = [];

  // ── Header: email subject ──────────────────────────────────────────
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: (subject || "No Subject").slice(0, 150),
      emoji: true,
    },
  });

  // ── Context: metadata (from, to, date) ─────────────────────────────
  const metaParts = [];
  if (from) metaParts.push(`*From:* ${from}`);
  if (to) metaParts.push(`*To:* ${to}`);
  if (date) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      metaParts.push(`*Date:* ${d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`);
    }
  }

  if (metaParts.length) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: metaParts.join("  |  "),
        },
      ],
    });
  }

  // ── Divider ────────────────────────────────────────────────────────
  blocks.push({ type: "divider" });

  // ── Body ───────────────────────────────────────────────────────────
  const cleanBody = stripHtml(body);
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: truncate(cleanBody),
    },
  });

  // ── Action button: open in Missive ─────────────────────────────────
  if (missiveLink) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Missive", emoji: true },
          url: missiveLink,
          style: "primary",
        },
      ],
    });
  }

  return blocks;
}

// ── Handler ──────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // CORS pre-flight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("SLACK_BOT_TOKEN is not set");
    return res.status(500).json({ ok: false, error: "Server misconfiguration" });
  }

  const { userId, subject, from, to, body, date, missiveLink } = req.body || {};

  if (!userId) {
    return res.status(400).json({ ok: false, error: "Missing required field: userId" });
  }

  try {
    const slack = new WebClient(token);

    // 1. Open (or retrieve) the DM channel with the target user
    const dmRes = await slack.conversations.open({ users: userId });
    if (!dmRes.ok) {
      throw new Error(dmRes.error || "Failed to open DM channel");
    }
    const channelId = dmRes.channel.id;

    // 2. Build and send the Block Kit message
    const blocks = buildBlocks({ subject, from, to, body, date, missiveLink });

    const msgRes = await slack.chat.postMessage({
      channel: channelId,
      text: `Email shared from Missive: ${subject || "No Subject"}`, // fallback
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (!msgRes.ok) {
      throw new Error(msgRes.error || "Failed to send message");
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({
      ok: true,
      channel: channelId,
      ts: msgRes.ts,
    });
  } catch (err) {
    console.error("Error sending Slack message:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
