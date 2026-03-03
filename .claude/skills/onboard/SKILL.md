---
name: onboard
description: Set up internbot for development. Use when setting up the project for the first time.
---

# Internbot Developer Setup

## Prerequisites

- Node.js >= 20
- A Slack workspace where you can create apps

## Steps

### 1. Create a Slack App

1. Go to https://api.slack.com/apps → Create New App → From scratch
2. Name it (e.g., "internbot"), select your workspace
3. Enable **Socket Mode** under Settings → Socket Mode → toggle on
   - Generate an app-level token with `connections:write` scope → save as `SLACK_APP_TOKEN`
4. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `groups:history`
   - `groups:read`
   - `im:history`
   - `im:read`
   - `mpim:history`
   - `mpim:read`
   - `users:read`
5. Under **Event Subscriptions** → toggle on → Subscribe to bot events:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
   - `app_mention`
6. Install the app to your workspace → copy the Bot User OAuth Token as `SLACK_BOT_TOKEN`

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your tokens:
#   SLACK_BOT_TOKEN=xoxb-...
#   SLACK_APP_TOKEN=xapp-...
#   ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Install & Run

```bash
npm install
npm run dev    # Development with hot reload
npm run build  # Compile TypeScript
npm start      # Run compiled version
```

### 4. Test

- DM the bot "hi" → should get a simple reply
- In a channel, @mention the bot with a question → should get a threaded response
- Ask it to search for papers → should use arxiv tools
