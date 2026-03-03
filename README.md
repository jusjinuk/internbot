# internbot

A minimal Slack bot for research labs. Routes messages through Haiku triage (cheap, fast) and escalates complex requests to an Opus agent running via the Claude Code SDK.

## How It Works

```
Slack message → whitelist filter → store in SQLite → Haiku triage
  ├─ ignore   → done (no API cost)
  ├─ simple   → Haiku reply → send to Slack (~$0.001)
  └─ escalate → Agent (Claude Code SDK) → send to Slack
```

**Two-layer triage:**
1. Free string match — if the bot isn't mentioned in a channel, ignore with zero cost
2. Haiku API call — classifies into ignore/simple/escalate

**Agent capabilities** (via MCP servers and built-in tools):
- ArXiv paper search and summarization
- Web search for recent information
- Research brainstorming
- Code review
- LaTeX report writing
- File read/write/edit, bash commands

## Setup

1. Create a Slack app with Socket Mode (see `.claude/skills/onboard/SKILL.md` for detailed steps)
2. Copy `.env.example` to `.env` and fill in your tokens
3. Install and run:

```bash
npm install
npm run dev    # Development with hot reload
npm run build  # Compile TypeScript
npm start      # Run compiled version
```

## Configuration

All config is in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token | (required) |
| `SLACK_APP_TOKEN` | Slack app-level token | (required) |
| `ANTHROPIC_API_KEY` | Anthropic API key | (required) |
| `ASSISTANT_NAME` | Bot display name | `internbot` |
| `WHITELISTED_CHANNELS` | Comma-separated channel IDs | (all channels) |

## Project Structure

```
src/
  index.ts      # Orchestrator: Slack events → triage → agent → reply
  slack.ts      # @slack/bolt Socket Mode connection
  triage.ts     # Haiku triage (Anthropic SDK direct API call)
  agent.ts      # Agent (Claude Code SDK, runs in host process)
  config.ts     # .env config reader
  db.ts         # SQLite (messages + sessions)
  skills.ts     # Skill discovery for triage context
  env.ts        # .env parser
  logger.ts     # Pino logger
  types.ts      # TypeScript interfaces
.claude/skills/
  onboard/         # Developer setup guide
  arxiv-search/    # Paper search skill
  web-search/      # Web search skill
  research-brainstorm/  # Research ideation skill
  code-review/     # Code review skill
  latex-report/    # LaTeX report skill
```

## License

MIT
