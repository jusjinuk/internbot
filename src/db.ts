import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { NewMessage, ScheduledTask } from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      channel_id TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER DEFAULT 0,
      is_bot_message INTEGER DEFAULT 0,
      thread_ts TEXT,
      PRIMARY KEY (id, channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);

    CREATE TABLE IF NOT EXISTS sessions (
      channel_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL CHECK(schedule_type IN ('once', 'cron')),
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_channel ON scheduled_tasks(channel_id);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'error')),
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
  `);
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  createSchema(db);
}

/** @internal — for tests only */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, channel_id, sender, sender_name, content, timestamp, is_from_me, is_bot_message, thread_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.channel_id,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
    msg.thread_ts || null,
  );
}

export function getRecentMessages(
  channelId: string,
  limit: number,
): NewMessage[] {
  return db
    .prepare(
      `SELECT id, channel_id, sender, sender_name, content, timestamp,
              is_from_me, is_bot_message, thread_ts
       FROM messages
       WHERE channel_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
    )
    .all(channelId, limit)
    .reverse() as NewMessage[];
}

export function getSession(channelId: string): string | undefined {
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE channel_id = ?')
    .get(channelId) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(channelId: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (channel_id, session_id) VALUES (?, ?)',
  ).run(channelId, sessionId);
}

// --- Scheduled tasks ---

export function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void {
  db.prepare(
    `INSERT INTO scheduled_tasks (id, channel_id, created_by, prompt, schedule_type, schedule_value, next_run, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    task.id,
    task.channel_id,
    task.created_by,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db
    .prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
    .get(id) as ScheduledTask | undefined;
}

export function getTasksForChannel(channelId: string): ScheduledTask[] {
  return db
    .prepare(
      `SELECT * FROM scheduled_tasks
       WHERE channel_id = ? AND status = 'active'
       ORDER BY created_at DESC`,
    )
    .all(channelId) as ScheduledTask[];
}

export function getAllActiveTasks(): ScheduledTask[] {
  return db
    .prepare(
      `SELECT * FROM scheduled_tasks
       WHERE status = 'active'
       ORDER BY created_at DESC`,
    )
    .all() as ScheduledTask[];
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `SELECT * FROM scheduled_tasks
       WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
       ORDER BY next_run ASC`,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  status: ScheduledTask['status'],
  lastResult: string | null,
): void {
  db.prepare(
    `UPDATE scheduled_tasks
     SET next_run = ?, status = ?, last_run = ?, last_result = ?
     WHERE id = ?`,
  ).run(nextRun, status, new Date().toISOString(), lastResult, id);
}

export function updateTask(
  id: string,
  updates: { prompt?: string; schedule_value?: string; next_run?: string },
): boolean {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }

  if (fields.length === 0) return false;

  values.push(id);
  const result = db
    .prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ? AND status = 'active'`)
    .run(...values);
  return result.changes > 0;
}

export function deleteTask(id: string): boolean {
  const result = db
    .prepare(`UPDATE scheduled_tasks SET status = 'cancelled' WHERE id = ? AND status = 'active'`)
    .run(id);
  return result.changes > 0;
}

export function logTaskRun(
  taskId: string,
  durationMs: number,
  status: 'success' | 'error',
  result: string | null,
  error: string | null,
): void {
  db.prepare(
    `INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(taskId, new Date().toISOString(), durationMs, status, result, error);
}
