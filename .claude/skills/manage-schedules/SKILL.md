---
name: manage-schedules
description: View, add, update, or cancel scheduled tasks. Use when asked about schedules, cron jobs, reminders, or recurring tasks.
---

# Manage Scheduled Tasks

## When to use

- User asks to see scheduled tasks, list schedules, or "what's scheduled?"
- User wants to add a new scheduled/recurring task
- User wants to update or cancel an existing task

## Database

Tasks are stored in SQLite at `store/messages.db` in the `scheduled_tasks` table.

## Viewing tasks

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
const tasks = db.prepare(\"SELECT * FROM scheduled_tasks WHERE status = 'active'\").all();
console.log(JSON.stringify(tasks, null, 2));
"
```

Fields: `id`, `channel_id`, `created_by`, `prompt`, `schedule_type` (once/cron), `schedule_value`, `next_run`, `last_run`, `last_result`, `status`, `created_at`

## Adding a task

```bash
node -e "
const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('store/messages.db');
db.prepare('INSERT INTO scheduled_tasks (id, channel_id, created_by, prompt, schedule_type, schedule_value, next_run, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
  'task-' + crypto.randomBytes(6).toString('hex'),
  '<CHANNEL_ID>',
  '<USER_NAME>',
  '<PROMPT>',
  '<once|cron>',
  '<ISO_TIMESTAMP_OR_CRON>',
  '<NEXT_RUN_ISO>',
  'active',
  new Date().toISOString()
);
"
```

- `schedule_type`: `once` for one-time, `cron` for recurring
- `schedule_value`: ISO timestamp for once, cron expression for cron (e.g., `0 9 * * 1-5` for weekdays at 9am)
- `next_run`: when the task should next fire (ISO timestamp)

## Updating a task

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
db.prepare('UPDATE scheduled_tasks SET prompt = ? WHERE id = ?').run('<NEW_PROMPT>', '<TASK_ID>');
"
```

Can update: `prompt`, `schedule_value`, `next_run`, `status`

To recompute `next_run` after changing a cron schedule:
```bash
node -e "
const { CronExpressionParser } = require('cron-parser');
const expr = CronExpressionParser.parse('<CRON_EXPRESSION>', { currentDate: new Date(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
console.log(expr.next().toISOString());
"
```

## Cancelling a task

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
db.prepare(\"UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ?\").run('<TASK_ID>');
"
```

## Viewing run history

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
const logs = db.prepare('SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT 10').all('<TASK_ID>');
console.log(JSON.stringify(logs, null, 2));
"
```

## Notes

- All times are in UTC in the database
- The scheduler polls every 60 seconds, so tasks may run up to 60s after their `next_run`
- Node must be available (use `nvm use 24` if needed before running commands)
- Run commands from the internbot project root: `/data_fast/home/jusjinuk/codes/internbot`
