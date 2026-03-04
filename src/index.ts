import { runAgent } from './agent.js';
import { ASSISTANT_NAME, WHITELISTED_CHANNELS } from './config.js';
import {
  getRecentMessages,
  initDatabase,
  storeMessage,
} from './db.js';
import { logger } from './logger.js';
import { startSchedulerLoop, stopSchedulerLoop } from './scheduler.js';
import { SlackConnection } from './slack.js';
import { triage } from './triage.js';
import { NewMessage } from './types.js';

const slack = new SlackConnection();

// Concurrency guard: one agent per channel at a time
const activeAgents = new Set<string>();

// Debounce timers per channel:sender
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 3000;

function handleMessage(msg: NewMessage): void {
  // Skip bot messages
  if (msg.is_bot_message || msg.is_from_me) return;

  // Whitelist filter (DMs always pass through)
  const isDm = msg.channel_type === 'im' || msg.channel_type === 'mpim';
  if (
    !isDm &&
    WHITELISTED_CHANNELS.length > 0 &&
    !WHITELISTED_CHANNELS.includes(msg.channel_id)
  ) {
    return;
  }

  // Store immediately
  storeMessage(msg);

  // Debounce: wait for burst to settle before triaging
  const debounceKey = `${msg.channel_id}:${msg.sender}`;
  const existing = debounceTimers.get(debounceKey);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    debounceKey,
    setTimeout(() => {
      debounceTimers.delete(debounceKey);
      processMessage(msg).catch((err) =>
        logger.error({ err, channelId: msg.channel_id }, 'Error processing message'),
      );
    }, DEBOUNCE_MS),
  );
}

async function processMessage(msg: NewMessage): Promise<void> {
  const isDm =
    msg.channel_type === 'im' || msg.channel_type === 'mpim';

  const isBusy = activeAgents.has(msg.channel_id);
  const recentContext = getRecentMessages(msg.channel_id, 10);

  const result = await triage(msg, recentContext, isDm, isBusy);

  if (result.action === 'ignore') {
    logger.debug(
      { channelId: msg.channel_id, sender: msg.sender_name },
      'Triage: ignore',
    );
    return;
  }

  if (result.action === 'simple' && result.reply) {
    logger.info(
      { channelId: msg.channel_id, sender: msg.sender_name },
      'Triage: simple reply',
    );
    await slack.sendMessage(msg.channel_id, result.reply, msg.thread_ts);

    // Store the bot's reply
    storeMessage({
      id: `bot-${Date.now()}`,
      channel_id: msg.channel_id,
      sender: ASSISTANT_NAME,
      sender_name: ASSISTANT_NAME,
      content: result.reply,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
      thread_ts: msg.thread_ts,
    });
    return;
  }

  // Escalate to agent
  activeAgents.add(msg.channel_id);

  logger.info(
    { channelId: msg.channel_id, sender: msg.sender_name },
    'Triage: escalate to agent',
  );

  await slack.addReaction(msg.channel_id, msg.id, 'hourglass_flowing_sand');

  await slack.sendMessage(
    msg.channel_id,
    result.reply || 'Working on it...',
    msg.thread_ts,
  );

  try {
    const agentResult = await runAgent(msg.content, msg.channel_id);

    await slack.sendMessage(
      msg.channel_id,
      agentResult.text,
      msg.thread_ts,
    );

    // Store the bot's reply
    storeMessage({
      id: `bot-${Date.now()}`,
      channel_id: msg.channel_id,
      sender: ASSISTANT_NAME,
      sender_name: ASSISTANT_NAME,
      content: agentResult.text,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
      thread_ts: msg.thread_ts,
    });
  } catch (err) {
    logger.error({ err, channelId: msg.channel_id }, 'Agent error');
    await slack.sendMessage(
      msg.channel_id,
      'Sorry, I encountered an error. Please try again.',
      msg.thread_ts,
    );
  } finally {
    activeAgents.delete(msg.channel_id);
    await slack.removeReaction(msg.channel_id, msg.id, 'hourglass_flowing_sand');
  }
}

async function main(): Promise<void> {
  initDatabase();
  logger.info('Database initialized');

  slack.onMessage(handleMessage);
  await slack.connect();

  // Start scheduler loop
  startSchedulerLoop({
    sendMessage: (channelId, text) => slack.sendMessage(channelId, text),
    isChannelBusy: (channelId) => activeAgents.has(channelId),
    markChannelBusy: (channelId) => activeAgents.add(channelId),
    markChannelFree: (channelId) => activeAgents.delete(channelId),
  });

  logger.info(
    { name: ASSISTANT_NAME },
    'internbot is running',
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    stopSchedulerLoop();
    await slack.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start internbot');
    process.exit(1);
  });
}
