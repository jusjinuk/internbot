import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { NewMessage } from './types.js';

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
