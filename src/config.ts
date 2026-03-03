import { readEnvFile } from './env.js';

const envConfig = readEnvFile([
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'ASSISTANT_NAME',
  'WHITELISTED_CHANNELS',
]);

export const SLACK_BOT_TOKEN =
  process.env.SLACK_BOT_TOKEN || envConfig.SLACK_BOT_TOKEN || '';
export const SLACK_APP_TOKEN =
  process.env.SLACK_APP_TOKEN || envConfig.SLACK_APP_TOKEN || '';
export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'internbot';

const rawWhitelist =
  process.env.WHITELISTED_CHANNELS || envConfig.WHITELISTED_CHANNELS || '';
export const WHITELISTED_CHANNELS: string[] = rawWhitelist
  ? rawWhitelist.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

export const TRIAGE_MODEL = 'claude-haiku-4-5-20251001';
export const AGENT_MODEL = 'claude-sonnet-4-6-20260320';

export const STORE_DIR = 'store';
