/**
 * GET /api/health
 *
 * Simple health-check to verify the deployment is alive and the
 * Slack tokens are configured in Vercel environment variables.
 */

module.exports = async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const botToken = !!process.env.SLACK_BOT_TOKEN;
  const userToken = !!process.env.SLACK_USER_TOKEN;

  return res.status(200).json({
    ok: true,
    status: "running",
    slackBotTokenConfigured: botToken,
    slackUserTokenConfigured: userToken,
    timestamp: new Date().toISOString(),
  });
};
