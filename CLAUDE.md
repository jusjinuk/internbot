# internbot

Research lab Slack bot. Haiku triage + Opus agent escalation. No Docker, no containers.

## Architecture

```
Slack message → whitelist filter → store in SQLite → Haiku triage
  ├─ ignore  → done
  ├─ simple  → Haiku reply → send to Slack
  └─ escalate → agent (Claude Code SDK, host process) → send to Slack
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main orchestrator: Slack events → triage → agent → reply |
| `src/slack.ts` | @slack/bolt Socket Mode connection |
| `src/triage.ts` | Two-layer triage: free mention check + Haiku API |
| `src/agent.ts` | Agent via Claude Code SDK |
| `src/config.ts` | .env config reader |
| `src/db.ts` | SQLite: messages + sessions |
| `src/skills.ts` | Skill discovery for triage context |
| `src/env.ts` | .env file parser |
| `src/logger.ts` | Pino logger |
| `src/types.ts` | TypeScript interfaces |

## Skills

| Skill | Purpose |
|-------|---------|
| `onboard` | Developer setup guide |
| `arxiv-search` | Search and summarize arxiv papers |
| `web-search` | Search the web for recent information |
| `research-brainstorm` | Brainstorm research directions from papers |
| `code-review` | Explain and review code |
| `latex-report` | Write LaTeX research reports |

## Development

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm test             # Run tests
```

## Service (systemd)

```bash
systemctl --user start internbot
systemctl --user stop internbot
systemctl --user restart internbot
```
