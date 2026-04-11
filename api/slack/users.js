/**
 * GET /api/slack/users
 *
 * Returns a filtered list of real (non-bot, non-deleted) Slack workspace
 * members.  The Missive sidebar calls this endpoint to populate the
 * "Select a user" picker.
 *
 * Required env var:  SLACK_BOT_TOKEN
 * Slack scope:       users:read
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
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("SLACK_BOT_TOKEN is not set");
    return res.status(500).json({ ok: false, error: "Server misconfiguration" });
  }

  try {
    const slack = new WebClient(token);

    // Paginate through all workspace members
    const members = [];
    let cursor;

    do {
      const page = await slack.users.list({
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });

      if (!page.ok) {
        throw new Error(page.error || "Slack API error");
      }

      // Keep only real, active human users
      const humans = (page.members || []).filter(
        (u) =>
          !u.deleted &&
          !u.is_bot &&
          u.id !== "USLACKBOT" &&
          !u.is_restricted &&
          !u.is_ultra_restricted
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

      cursor = page.response_metadata?.next_cursor;
    } while (cursor);

    // Sort alphabetically by display name
    members.sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: "base",
      })
    );

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ ok: true, members });
  } catch (err) {
    console.error("Error fetching Slack users:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
