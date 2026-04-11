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
 *   "userId":        "U12345678",            // Slack user ID
 *   "subject":       "Re: Q3 Report",        // Email subject
 *   "from":          "Alice <a@b.com>",      // Sender
 *   "to":            "Bob <b@b.com>",        // Recipient(s)
 *   "body":          "<p>Hi team...</p>",    // HTML or plain-text body
 *   "date":          "2025-06-15T10:30:00Z", // ISO timestamp (optional)
 *   "missiveLink":   "https://mail.missiveapp.com/..." // deep link (optional)
 * }
 */

const { WebClient } = require("@slack/web-api");

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Robustly strip HTML from an email body.
 *
 * Emails often contain large <style> and <script> blocks whose *content*
 * (CSS rules, JS) must be removed entirely — not just the tags themselves.
 * A simple tag-stripping regex leaves all that text behind, which is what
 * caused the raw CSS to appear in the Slack message.
 */
function stripHtml(html) {
  if (!html) return "";

  let text = html;

  // 1. Remove entire <style>…</style> and <script>…</script> blocks
  //    including all the CSS/JS content between them.
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
 * Truncate text to fit Slack's 3 000-char section limit.
 */
function truncate(text, max = 2900) {
  if (!text) return "_No body content._";
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n…_(truncated)_";
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
  if (to)   metaParts.push(`*To:* ${to}`);
  if (date) {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      metaParts.push(
        `*Date:* ${d.toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })}`
      );
    }
  }

  if (metaParts.length) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: metaParts.join("  |  ") }],
    });
  }

  // ── Divider ────────────────────────────────────────────────────────
  blocks.push({ type: "divider" });

  // ── Body (plain text, fully stripped) ─────────────────────────────
  const cleanBody = truncate(stripHtml(body));
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: cleanBody },
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

  const { userId, subject, from, to, body, date, missiveLink, senderName } =
    req.body || {};

  if (!userId) {
    return res.status(400).json({ ok: false, error: "Missing required field: userId" });
  }

  try {
    const slack = new WebClient(token);

    // 1. Open (or retrieve) the DM channel with the target user
    const dmRes = await slack.conversations.open({ users: userId });
    if (!dmRes.ok) throw new Error(dmRes.error || "Failed to open DM channel");
    const channelId = dmRes.channel.id;

    // 2. Build the Block Kit message
    const blocks = buildBlocks({ subject, from, to, body, date, missiveLink });

    // 3. Post the message.
    //    We use `username` + `icon_emoji` as a cosmetic override so the
    //    message appears to come from "davidhoang via Missive" rather than
    //    the generic bot name.  Requires the `chat:write.customize` scope.
    //    Note: Slack does NOT allow truly sending "as" another user with a
    //    bot token — that requires a full user OAuth token (chat:write:user).
    const displayName = senderName || process.env.SENDER_DISPLAY_NAME || "davidhoang via Missive";

    const msgRes = await slack.chat.postMessage({
      channel: channelId,
      text: `Email shared from Missive: ${subject || "No Subject"}`, // fallback for notifications
      blocks,
      username: displayName,
      icon_emoji: ":email:",
      unfurl_links: false,
      unfurl_media: false,
    });

    if (!msgRes.ok) throw new Error(msgRes.error || "Failed to send message");

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ ok: true, channel: channelId, ts: msgRes.ts });
  } catch (err) {
    console.error("Error sending Slack message:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
