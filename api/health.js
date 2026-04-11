/**
 * GET /api/health
 *
 * Simple health-check endpoint.  Useful for verifying the deployment is
 * alive and the SLACK_BOT_TOKEN environment variable is configured.
 */
module.exports = async function handler(req, res) {
  const hasToken = !!process.env.SLACK_BOT_TOKEN;

  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({
    ok: true,
    status: "running",
    slackTokenConfigured: hasToken,
    timestamp: new Date().toISOString(),
  });
};
