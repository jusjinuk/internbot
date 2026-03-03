import { CronExpressionParser } from 'cron-parser';
import crypto from 'crypto';

import { runAgent } from './agent.js';
import { ASSISTANT_NAME, TIMEZONE, WHITELISTED_CHANNELS } from './config.js';
import {
  createTask,
  deleteTask,
  getRecentMessages,
  getTasksForChannel,
  initDatabase,
  storeMessage,
} from './db.js';
import { logger } from './logger.js';
import { startSchedulerLoop, stopSchedulerLoop } from './scheduler.js';
import { SlackConnection } from './slack.js';
import { triage } from './triage.js';
import { NewMessage, ScheduledTask } from './types.js';

const slack = new SlackConnection();

// Concurrency guard: one agent per channel at a time
const activeAgents = new Set<string>();

// Debounce timers per channel:sender
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 3000;

function handleMessage(msg: NewMessage): void {
  // Skip bot messages
  if (msg.is_bot_message || msg.is_from_me) return;

  // Whitelist filter
  if (
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

  if (result.action === 'schedule' && result.schedule) {
    await handleScheduleCreate(msg, result.schedule, result.reply);
    return;
  }

  if (result.action === 'schedule_manage' && result.manage) {
    await handleScheduleManage(msg, result.manage, result.reply);
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

async function handleScheduleCreate(
  msg: NewMessage,
  schedule: NonNullable<import('./types.js').TriageResult['schedule']>,
  reply?: string,
): Promise<void> {
  logger.info(
    { channelId: msg.channel_id, sender: msg.sender_name, schedule },
    'Triage: schedule',
  );

  // Validate the schedule value
  if (schedule.type === 'cron') {
    try {
      CronExpressionParser.parse(schedule.value, { tz: TIMEZONE });
    } catch {
      await slack.sendMessage(
        msg.channel_id,
        `Sorry, I couldn't parse that as a valid cron schedule: \`${schedule.value}\`. Try something like "every Monday at 9am" or "every day at 3pm".`,
        msg.thread_ts,
      );
      return;
    }
  } else {
    const ts = new Date(schedule.value);
    if (isNaN(ts.getTime())) {
      await slack.sendMessage(
        msg.channel_id,
        `Sorry, I couldn't parse that as a valid time: \`${schedule.value}\`. Try something like "in 5 minutes" or "at 3pm".`,
        msg.thread_ts,
      );
      return;
    }
    if (ts.getTime() <= Date.now()) {
      await slack.sendMessage(
        msg.channel_id,
        'That time is in the past. Please specify a future time.',
        msg.thread_ts,
      );
      return;
    }
  }

  // Compute next_run
  let nextRun: string;
  if (schedule.type === 'once') {
    nextRun = new Date(schedule.value).toISOString();
  } else {
    const expr = CronExpressionParser.parse(schedule.value, {
      currentDate: new Date(),
      tz: TIMEZONE,
    });
    nextRun = expr.next().toISOString() ?? new Date().toISOString();
  }

  const taskId = `task-${crypto.randomBytes(6).toString('hex')}`;
  const task: Omit<ScheduledTask, 'last_run' | 'last_result'> = {
    id: taskId,
    channel_id: msg.channel_id,
    created_by: msg.sender_name,
    prompt: schedule.prompt,
    schedule_type: schedule.type,
    schedule_value: schedule.value,
    next_run: nextRun,
    status: 'active',
    created_at: new Date().toISOString(),
  };

  createTask(task);

  const timeDesc = schedule.type === 'once'
    ? `at ${new Date(schedule.value).toLocaleString()}`
    : `on schedule \`${schedule.value}\``;
  const confirmMsg = reply || `Scheduled: "${schedule.prompt}" ${timeDesc} [${taskId}]`;

  await slack.sendMessage(msg.channel_id, confirmMsg, msg.thread_ts);

  storeMessage({
    id: `bot-${Date.now()}`,
    channel_id: msg.channel_id,
    sender: ASSISTANT_NAME,
    sender_name: ASSISTANT_NAME,
    content: confirmMsg,
    timestamp: new Date().toISOString(),
    is_from_me: true,
    is_bot_message: true,
    thread_ts: msg.thread_ts,
  });
}

async function handleScheduleManage(
  msg: NewMessage,
  manage: NonNullable<import('./types.js').TriageResult['manage']>,
  reply?: string,
): Promise<void> {
  logger.info(
    { channelId: msg.channel_id, sender: msg.sender_name, manage },
    'Triage: schedule_manage',
  );

  if (manage.operation === 'list') {
    const tasks = getTasksForChannel(msg.channel_id);
    let response: string;
    if (tasks.length === 0) {
      response = reply || 'No active scheduled tasks in this channel.';
    } else {
      const lines = tasks.map((t) => {
        const nextStr = t.next_run
          ? `next run: ${new Date(t.next_run).toLocaleString()}`
          : 'no upcoming run';
        return `- \`${t.id}\` "${t.prompt}" (${t.schedule_type}: ${t.schedule_value}, ${nextStr})`;
      });
      response = `*Scheduled tasks:*\n${lines.join('\n')}`;
    }
    await slack.sendMessage(msg.channel_id, response, msg.thread_ts);
    return;
  }

  if (manage.operation === 'cancel' && manage.taskId) {
    const deleted = deleteTask(manage.taskId);
    const response = deleted
      ? reply || `Task \`${manage.taskId}\` has been cancelled.`
      : `Task \`${manage.taskId}\` not found or already cancelled.`;
    await slack.sendMessage(msg.channel_id, response, msg.thread_ts);
    return;
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
