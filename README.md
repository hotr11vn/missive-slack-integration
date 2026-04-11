# Missive to Slack Integration

A custom integration for Missive that allows users to share emails directly to a Slack user via Direct Message (DM). It mimics the functionality of the official "Slack for Gmail" add-on.

This project is built as a serverless web application ready to be deployed to **Vercel**. It consists of a frontend HTML/JS app that runs inside Missive's sidebar iFrame, and backend API routes that securely communicate with the Slack Web API.

---

## Features

- **Native Missive Feel**: The sidebar UI is styled to match Missive's clean interface.
- **Context Menu Action**: Adds a "Share to Slack" button to email context menus.
- **Dynamic User Picker**: Fetches real, active human users from your Slack workspace.
- **Rich Slack Messages**: Formats the shared email using Slack Block Kit, including subject, sender/recipient metadata, body preview, and a deep link back to Missive.

---

## 1. Slack App Setup

To interact with Slack, you need to create a Slack App and obtain a Bot Token.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App** (choose "From scratch").
2. Name it "Missive Integration" and select your workspace.
3. In the left sidebar, go to **OAuth & Permissions**.
4. Scroll down to **Scopes** → **Bot Token Scopes** and add the following:
   - `users:read` (to list workspace users)
   - `chat:write` (to send messages)
   - `im:write` (to open Direct Messages)
5. Scroll up and click **Install to Workspace**.
6. Copy the **Bot User OAuth Token** (it starts with `xoxb-`). You will need this for deployment.

---

## 2. Deploy to Vercel

The easiest way to host this integration is via Vercel, as it automatically handles the static frontend files and the Node.js serverless functions.

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. Log in to [Vercel](https://vercel.com/) and click **Add New...** → **Project**.
3. Import your repository.
4. In the **Environment Variables** section, add:
   - Name: `SLACK_BOT_TOKEN`
   - Value: `xoxb-your-token-here` (from Step 1)
5. Click **Deploy**.
6. Once deployed, note your Vercel production domain (e.g., `https://your-app.vercel.app`).

*(Note: You can verify the deployment is working by visiting `https://your-app.vercel.app/api/health` in your browser).*

---

## 3. Missive Setup

Now that the app is hosted, you need to configure it inside Missive.

1. Open Missive and go to **Settings** → **Integrations**.
2. Click **Add integration** and choose **Custom Integration**.
3. Provide a name (e.g., "Slack Share").
4. In the **iFrame URL** field, enter your Vercel domain:
   `https://your-app.vercel.app/`
5. *(Optional but recommended)*: Under the **Security** section, Missive allows you to pass a token. If you implement token validation in the future, you can append `?token=YOUR_SECRET` to the URL.
6. Click **Save**.

The integration will now appear in your Missive right-hand sidebar. When you select an email, the app will load, fetch your Slack users, and allow you to share the conversation!

---

## Project Structure

```text
.
├── api/
│   ├── health.js         # Health check endpoint
│   └── slack/
│       ├── send.js       # Opens DM and posts Block Kit message to Slack
│       └── users.js      # Fetches and filters Slack workspace users
├── public/
│   ├── index.html        # The Missive sidebar UI
│   └── assets/
│       ├── app.js        # Frontend logic (Missive SDK + API calls)
│       └── style.css     # UI styling
├── package.json          # Dependencies (@slack/web-api)
└── vercel.json           # Vercel routing configuration
```

## Local Development

If you want to run this locally to make changes:

1. Install the Vercel CLI: `npm i -g vercel`
2. Install dependencies: `npm install`
3. Create a `.env` file based on `.env.example` and add your `SLACK_BOT_TOKEN`.
4. Run the local dev server: `vercel dev`
5. The app will be available at `http://localhost:3000`.

*(Note: Missive requires custom integrations to be served over HTTPS. To test locally inside Missive, you will need a tunneling service like ngrok: `ngrok http 3000`)*.
