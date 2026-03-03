import { CronExpressionParser } from 'cron-parser';

import { runAgent } from './agent.js';
import { ASSISTANT_NAME, SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import {
  getDueTasks,
  logTaskRun,
  storeMessage,
  updateTaskAfterRun,
} from './db.js';
import { logger } from './logger.js';
import { ScheduledTask } from './types.js';

export interface SchedulerDeps {
  sendMessage: (channelId: string, text: string) => Promise<void>;
  isChannelBusy: (channelId: string) => boolean;
  markChannelBusy: (channelId: string) => void;
  markChannelFree: (channelId: string) => void;
}

const runningTasks = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') return null;

  try {
    const expr = CronExpressionParser.parse(task.schedule_value, {
      currentDate: new Date(),
      tz: TIMEZONE,
    });
    return expr.next().toISOString() ?? new Date().toISOString();
  } catch {
    logger.error({ taskId: task.id, cron: task.schedule_value }, 'Invalid cron expression');
    return null;
  }
}

async function executeTask(
  task: ScheduledTask,
  deps: SchedulerDeps,
): Promise<void> {
  if (runningTasks.has(task.id)) return;
  if (deps.isChannelBusy(task.channel_id)) {
    logger.debug({ taskId: task.id }, 'Channel busy, skipping task until next poll');
    return;
  }

  runningTasks.add(task.id);
  deps.markChannelBusy(task.channel_id);
  const startTime = Date.now();

  try {
    logger.info({ taskId: task.id, prompt: task.prompt }, 'Running scheduled task');

    const result = await runAgent(task.prompt, task.channel_id);
    const durationMs = Date.now() - startTime;

    await deps.sendMessage(
      task.channel_id,
      `*Scheduled task:* ${task.prompt}\n\n${result.text}`,
    );

    storeMessage({
      id: `bot-${Date.now()}`,
      channel_id: task.channel_id,
      sender: ASSISTANT_NAME,
      sender_name: ASSISTANT_NAME,
      content: result.text,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
    });

    const nextRun = computeNextRun(task);
    const newStatus = nextRun ? 'active' : 'completed';
    updateTaskAfterRun(task.id, nextRun, newStatus, result.text.slice(0, 500));
    logTaskRun(task.id, durationMs, 'success', result.text.slice(0, 500), null);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);

    logger.error({ err, taskId: task.id }, 'Scheduled task failed');

    await deps.sendMessage(
      task.channel_id,
      `Scheduled task "${task.prompt}" failed: ${errMsg}`,
    );

    const nextRun = computeNextRun(task);
    const newStatus = nextRun ? 'active' : 'completed';
    updateTaskAfterRun(task.id, nextRun, newStatus, null);
    logTaskRun(task.id, durationMs, 'error', null, errMsg);
  } finally {
    runningTasks.delete(task.id);
    deps.markChannelFree(task.channel_id);
  }
}

async function pollOnce(deps: SchedulerDeps): Promise<void> {
  try {
    const dueTasks = getDueTasks();
    if (dueTasks.length > 0) {
      logger.info({ count: dueTasks.length }, 'Found due tasks');
    }

    // Execute tasks sequentially to avoid overwhelming the system
    for (const task of dueTasks) {
      await executeTask(task, deps);
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler poll error');
  }
}

export function startSchedulerLoop(deps: SchedulerDeps): void {
  logger.info(
    { intervalMs: SCHEDULER_POLL_INTERVAL },
    'Starting scheduler loop',
  );

  const tick = () => {
    pollOnce(deps).finally(() => {
      timer = setTimeout(tick, SCHEDULER_POLL_INTERVAL);
    });
  };

  // Start first poll after one interval
  timer = setTimeout(tick, SCHEDULER_POLL_INTERVAL);
}

export function stopSchedulerLoop(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
