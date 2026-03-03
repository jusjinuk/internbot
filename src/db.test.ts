import { describe, expect, it, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  storeMessage,
  getRecentMessages,
  getSession,
  setSession,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('messages', () => {
  it('stores and retrieves messages', () => {
    storeMessage({
      id: 'msg1',
      channel_id: 'C123',
      sender: 'U001',
      sender_name: 'Alice',
      content: 'Hello',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    storeMessage({
      id: 'msg2',
      channel_id: 'C123',
      sender: 'U002',
      sender_name: 'Bob',
      content: 'Hi there',
      timestamp: '2024-01-01T00:01:00.000Z',
    });

    const messages = getRecentMessages('C123', 10);
    expect(messages).toHaveLength(2);
    expect(messages[0].sender_name).toBe('Alice');
    expect(messages[1].sender_name).toBe('Bob');
  });

  it('limits results', () => {
    for (let i = 0; i < 5; i++) {
      storeMessage({
        id: `msg${i}`,
        channel_id: 'C123',
        sender: 'U001',
        sender_name: 'Alice',
        content: `Message ${i}`,
        timestamp: `2024-01-01T00:0${i}:00.000Z`,
      });
    }

    const messages = getRecentMessages('C123', 3);
    expect(messages).toHaveLength(3);
    // Should be the 3 most recent, in chronological order
    expect(messages[0].content).toBe('Message 2');
    expect(messages[2].content).toBe('Message 4');
  });

  it('filters by channel', () => {
    storeMessage({
      id: 'msg1',
      channel_id: 'C123',
      sender: 'U001',
      sender_name: 'Alice',
      content: 'In channel 1',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    storeMessage({
      id: 'msg2',
      channel_id: 'C456',
      sender: 'U001',
      sender_name: 'Alice',
      content: 'In channel 2',
      timestamp: '2024-01-01T00:01:00.000Z',
    });

    expect(getRecentMessages('C123', 10)).toHaveLength(1);
    expect(getRecentMessages('C456', 10)).toHaveLength(1);
  });

  it('handles upsert on duplicate id+channel', () => {
    storeMessage({
      id: 'msg1',
      channel_id: 'C123',
      sender: 'U001',
      sender_name: 'Alice',
      content: 'Original',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    storeMessage({
      id: 'msg1',
      channel_id: 'C123',
      sender: 'U001',
      sender_name: 'Alice',
      content: 'Updated',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    const messages = getRecentMessages('C123', 10);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Updated');
  });
});

describe('sessions', () => {
  it('returns undefined for missing session', () => {
    expect(getSession('C123')).toBeUndefined();
  });

  it('stores and retrieves sessions', () => {
    setSession('C123', 'session-abc');
    expect(getSession('C123')).toBe('session-abc');
  });

  it('overwrites existing session', () => {
    setSession('C123', 'session-1');
    setSession('C123', 'session-2');
    expect(getSession('C123')).toBe('session-2');
  });
});
