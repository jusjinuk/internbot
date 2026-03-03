import { describe, expect, it } from 'vitest';

import { isBotMentioned, parseTriageResponse } from './triage.js';

describe('isBotMentioned', () => {
  it('detects @internbot mention', () => {
    expect(isBotMentioned('@internbot what papers on RL?')).toBe(true);
  });

  it('detects case-insensitive mention', () => {
    expect(isBotMentioned('@Internbot help')).toBe(true);
  });

  it('detects name without @ prefix', () => {
    expect(isBotMentioned('hey internbot, find papers')).toBe(true);
  });

  it('returns false for unrelated messages', () => {
    expect(isBotMentioned('hey everyone, meeting at 3')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBotMentioned('')).toBe(false);
  });
});

describe('parseTriageResponse', () => {
  it('parses ignore action', () => {
    expect(parseTriageResponse('{"action": "ignore"}')).toEqual({
      action: 'ignore',
    });
  });

  it('parses simple action with reply', () => {
    expect(
      parseTriageResponse('{"action": "simple", "reply": "Hello!"}'),
    ).toEqual({
      action: 'simple',
      reply: 'Hello!',
    });
  });

  it('parses escalate action', () => {
    expect(parseTriageResponse('{"action": "escalate"}')).toEqual({
      action: 'escalate',
    });
  });

  it('extracts JSON from markdown code block', () => {
    expect(
      parseTriageResponse('```json\n{"action": "escalate"}\n```'),
    ).toEqual({ action: 'escalate' });
  });

  it('returns ignore for malformed response', () => {
    expect(parseTriageResponse('not json at all')).toEqual({
      action: 'ignore',
    });
  });

  it('returns ignore for simple action without reply', () => {
    expect(parseTriageResponse('{"action": "simple"}')).toEqual({
      action: 'ignore',
    });
  });

  it('returns ignore for unknown action', () => {
    expect(parseTriageResponse('{"action": "unknown"}')).toEqual({
      action: 'ignore',
    });
  });
});
