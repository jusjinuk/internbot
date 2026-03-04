#!/usr/bin/env tsx
/**
 * CLI for managing scheduled tasks.
 *
 * Usage:
 *   tsx src/schedule-cli.ts list [--channel <id>]
 *   tsx src/schedule-cli.ts add --channel <id> --user <name> --prompt <text> --type <once|cron> --value <iso|cron> [--next-run <iso>]
 *   tsx src/schedule-cli.ts get <task-id>
 *   tsx src/schedule-cli.ts cancel <task-id>
 *   tsx src/schedule-cli.ts update <task-id> [--prompt <text>] [--value <cron>] [--next-run <iso>]
 *   tsx src/schedule-cli.ts logs <task-id>
 */

import crypto from 'crypto';

import { CronExpressionParser } from 'cron-parser';

import { TIMEZONE } from './config.js';
import {
  deleteTask,
  getAllActiveTasks,
  getTaskById,
  getTasksForChannel,
  initDatabase,
  updateTask,
} from './db.js';

// We need to insert directly since createTask requires the full object
import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from './config.js';

initDatabase();

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function computeNextRun(type: string, value: string): string {
  if (type === 'once') {
    return new Date(value).toISOString();
  }
  const expr = CronExpressionParser.parse(value, {
    currentDate: new Date(),
    tz: TIMEZONE,
  });
  return expr.next().toISOString() ?? new Date().toISOString();
}

function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

try {
  switch (command) {
    case 'list': {
      const channel = flag('channel');
      const tasks = channel ? getTasksForChannel(channel) : getAllActiveTasks();
      output(tasks);
      break;
    }

    case 'get': {
      const id = args[1];
      if (!id) { console.error('Usage: get <task-id>'); process.exit(1); }
      const task = getTaskById(id);
      if (!task) { console.error(`Task ${id} not found`); process.exit(1); }
      output(task);
      break;
    }

    case 'add': {
      const channel = flag('channel');
      const user = flag('user');
      const prompt = flag('prompt');
      const type = flag('type') as 'once' | 'cron';
      const value = flag('value');

      if (!channel || !user || !prompt || !type || !value) {
        console.error('Usage: add --channel <id> --user <name> --prompt <text> --type <once|cron> --value <iso|cron>');
        process.exit(1);
      }

      if (type !== 'once' && type !== 'cron') {
        console.error('--type must be "once" or "cron"');
        process.exit(1);
      }

      // Validate
      if (type === 'cron') {
        CronExpressionParser.parse(value, { tz: TIMEZONE });
      } else {
        const ts = new Date(value);
        if (isNaN(ts.getTime())) { console.error(`Invalid timestamp: ${value}`); process.exit(1); }
        if (ts.getTime() <= Date.now()) { console.error('Timestamp is in the past'); process.exit(1); }
      }

      const nextRun = flag('next-run') || computeNextRun(type, value);
      const id = `task-${crypto.randomBytes(6).toString('hex')}`;

      // Use the DB directly since createTask expects an import cycle-free approach
      const db = new Database(path.join(STORE_DIR, 'messages.db'));
      db.prepare(
        `INSERT INTO scheduled_tasks (id, channel_id, created_by, prompt, schedule_type, schedule_value, next_run, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      ).run(id, channel, user, prompt, type, value, nextRun, new Date().toISOString());
      db.close();

      output({ id, channel_id: channel, created_by: user, prompt, schedule_type: type, schedule_value: value, next_run: nextRun, status: 'active' });
      break;
    }

    case 'cancel': {
      const id = args[1];
      if (!id) { console.error('Usage: cancel <task-id>'); process.exit(1); }
      const ok = deleteTask(id);
      if (!ok) { console.error(`Task ${id} not found or already cancelled`); process.exit(1); }
      output({ id, status: 'cancelled' });
      break;
    }

    case 'update': {
      const id = args[1];
      if (!id) { console.error('Usage: update <task-id> [--prompt <text>] [--value <cron>] [--next-run <iso>]'); process.exit(1); }

      const updates: { prompt?: string; schedule_value?: string; next_run?: string } = {};
      const p = flag('prompt');
      const v = flag('value');
      const nr = flag('next-run');

      if (p) updates.prompt = p;
      if (v) {
        updates.schedule_value = v;
        // Auto-recompute next_run for cron if not explicitly provided
        if (!nr) {
          const task = getTaskById(id);
          if (task && task.schedule_type === 'cron') {
            updates.next_run = computeNextRun('cron', v);
          }
        }
      }
      if (nr) updates.next_run = nr;

      if (Object.keys(updates).length === 0) {
        console.error('Nothing to update. Use --prompt, --value, or --next-run');
        process.exit(1);
      }

      const ok = updateTask(id, updates);
      if (!ok) { console.error(`Task ${id} not found or not active`); process.exit(1); }
      output({ id, ...updates, status: 'updated' });
      break;
    }

    case 'logs': {
      const id = args[1];
      if (!id) { console.error('Usage: logs <task-id>'); process.exit(1); }
      const db = new Database(path.join(STORE_DIR, 'messages.db'));
      const logs = db.prepare('SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT 10').all(id);
      db.close();
      output(logs);
      break;
    }

    default:
      console.error(`Unknown command: ${command}\nCommands: list, get, add, cancel, update, logs`);
      process.exit(1);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
