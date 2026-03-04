import { query } from '@anthropic-ai/claude-agent-sdk';

import { ASSISTANT_NAME, TIMEZONE, TRIAGE_MODEL } from './config.js';
import { getTasksForChannel } from './db.js';
import { logger } from './logger.js';
import { discoverSkills } from './skills.js';
import { NewMessage, ScheduledTask, TriageResult } from './types.js';

/**
 * Free check: does the message mention the bot?
 * Returns true if the bot is mentioned by name or @-mention.
 */
export function isBotMentioned(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes(`@${ASSISTANT_NAME.toLowerCase()}`) ||
    lower.includes(ASSISTANT_NAME.toLowerCase())
  );
}

/**
 * Parse the JSON response from Haiku triage.
 * Handles malformed responses gracefully.
 */
export function parseTriageResponse(text: string): TriageResult {
  try {
    // Extract JSON from potential markdown code block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { action: 'ignore' };

    const parsed = JSON.parse(jsonMatch[0]);
    const action = parsed.action;

    if (action === 'simple' && parsed.reply) {
      return { action: 'simple', reply: parsed.reply };
    }
    if (action === 'escalate') {
      return { action: 'escalate', reply: parsed.reply };
    }
    if (action === 'schedule' && parsed.schedule) {
      const { prompt, type, value } = parsed.schedule;
      if (prompt && (type === 'once' || type === 'cron') && value) {
        return {
          action: 'schedule',
          reply: parsed.reply,
          schedule: { prompt, type, value },
        };
      }
    }
    if (action === 'schedule_manage' && parsed.manage) {
      const { operation, taskId, updates } = parsed.manage;
      if (operation === 'list') {
        return {
          action: 'schedule_manage',
          reply: parsed.reply,
          manage: { operation },
        };
      }
      if (operation === 'cancel' && taskId) {
        return {
          action: 'schedule_manage',
          reply: parsed.reply,
          manage: { operation, taskId },
        };
      }
      if (operation === 'update' && taskId && updates) {
        return {
          action: 'schedule_manage',
          reply: parsed.reply,
          manage: { operation, taskId, updates },
        };
      }
    }
    return { action: 'ignore' };
  } catch {
    return { action: 'ignore' };
  }
}

/**
 * Triage: Haiku classifies every message.
 * In channels, Haiku decides if the message is directed at the bot.
 */
export async function triage(
  msg: NewMessage,
  recentContext: NewMessage[],
  isDm: boolean,
  isBusy = false,
): Promise<TriageResult> {
  const skills = discoverSkills();
  const contextLines = recentContext
    .slice(-5)
    .map((m) => `${m.sender_name}: ${m.content}`)
    .join('\n');

  const busyNotice = isBusy
    ? `\n\nIMPORTANT: The agent is currently busy with a previous request. If the message would normally be "escalate", classify it as "simple" instead and reply with a brief, contextual message letting the user know you're still working on something and will get to their request next.`
    : '';

  // Build active tasks context for cancel/list operations
  let activeTasks: ScheduledTask[] = [];
  try {
    activeTasks = getTasksForChannel(msg.channel_id);
  } catch { /* db may not be ready */ }
  const tasksContext = activeTasks.length > 0
    ? `\n\nActive scheduled tasks in this channel:\n${activeTasks.map((t) => `- [${t.id}] "${t.prompt}" (${t.schedule_type}: ${t.schedule_value})`).join('\n')}`
    : '';

  const now = new Date();
  const timeContext = `\nCurrent time: ${now.toISOString()} (timezone: ${TIMEZONE})`;

  const systemPrompt = `You are a triage classifier for ${ASSISTANT_NAME}, a research assistant bot in Slack.

Available skills: ${skills.join(', ') || 'none'}
Message is from: ${isDm ? 'a direct message (always directed at the bot)' : 'a channel (may or may not be directed at the bot)'}
Bot name: ${ASSISTANT_NAME}${timeContext}${tasksContext}

Classify the user's message into one of:
- "ignore": not directed at the bot, people talking to each other, human chatter, or messages that don't need a response. In channels, most messages are people talking to each other — only respond if the bot is explicitly addressed (by name, @mention, or clearly directed at it)
- "simple": greeting, acknowledgment, or a question answerable in 1-2 sentences without tools
- "escalate": paper search, code review, brainstorming, report writing, web search, complex questions, anything requiring tools or detailed analysis
- "schedule": user wants to set up a one-time reminder or recurring task
- "schedule_manage": user wants to list, cancel, or update scheduled tasks

Respond with ONLY a JSON object. For "simple", include a reply. For "escalate", include a brief contextual acknowledgment message (1 sentence, letting the user know you're on it). For "schedule", include schedule details. For "schedule_manage", include the manage operation. Examples:
{"action": "ignore"}
{"action": "simple", "reply": "Hi! How can I help you today?"}
{"action": "escalate", "reply": "Let me search for that paper — one moment."}
{"action": "schedule", "reply": "I'll set that reminder for you.", "schedule": {"prompt": "check the server status", "type": "once", "value": "2026-03-03T15:00:00.000Z"}}
{"action": "schedule", "reply": "I'll search arxiv for RL papers every Monday.", "schedule": {"prompt": "search arxiv for recent reinforcement learning papers and summarize the top 3", "type": "cron", "value": "0 9 * * 1"}}
{"action": "schedule_manage", "reply": "Here are your scheduled tasks.", "manage": {"operation": "list"}}
{"action": "schedule_manage", "reply": "I'll cancel that task.", "manage": {"operation": "cancel", "taskId": "task-abc123"}}
{"action": "schedule_manage", "reply": "I'll update that task's schedule.", "manage": {"operation": "update", "taskId": "task-abc123", "updates": {"schedule_value": "0 9 * * *"}}}
{"action": "schedule_manage", "reply": "I'll update the task prompt.", "manage": {"operation": "update", "taskId": "task-abc123", "updates": {"prompt": "search arxiv for RL and robotics papers"}}}${busyNotice}`;

  const userMessage = contextLines
    ? `Recent conversation:\n${contextLines}\n\nNew message from ${msg.sender_name}: ${msg.content}`
    : `Message from ${msg.sender_name}: ${msg.content}`;

  try {
    let resultText = '';

    for await (const message of query({
      prompt: userMessage,
      options: {
        model: TRIAGE_MODEL,
        systemPrompt: systemPrompt,
        tools: [],
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        cwd: process.cwd(),
      },
    })) {
      if (message.type === 'result') {
        const text =
          'result' in message
            ? (message as { result?: string }).result
            : null;
        if (text) {
          resultText += text;
        }
      }
    }

    return parseTriageResponse(resultText);
  } catch (err) {
    logger.error({ err }, 'Triage API call failed, defaulting to escalate');
    return { action: 'escalate' };
  }
}
