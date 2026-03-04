import { query } from '@anthropic-ai/claude-agent-sdk';

import { ASSISTANT_NAME, TRIAGE_MODEL } from './config.js';
import { logger } from './logger.js';
import { discoverSkills } from './skills.js';
import { NewMessage, TriageResult } from './types.js';

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

  const systemPrompt = `You are a triage classifier for ${ASSISTANT_NAME}, a helpful assistant bot in a research lab's Slack workspace. The bot specializes in research tasks but also helps with any reasonable request from lab members.

Available skills: ${skills.join(', ') || 'none'}
Message is from: ${isDm ? 'a direct message (always directed at the bot)' : 'a channel (may or may not be directed at the bot)'}
Bot name: ${ASSISTANT_NAME}

Classify the user's message into one of:
- "ignore": not directed at the bot, people talking to each other, human chatter, or messages that don't need a response. In channels, most messages are people talking to each other — only respond if the bot is explicitly addressed (by name, @mention, or clearly directed at it)
- "simple": ONLY for greetings, acknowledgments, trivial factual questions answerable in 1-2 sentences, or refusing clearly unethical/dangerous requests (e.g., hacking, harassment, illegal activity). Never use "simple" to decline a legitimate task — if the request is reasonable, escalate instead.
- "escalate": anything else directed at the bot, including but not limited to: paper search, code review, brainstorming, report writing, web search, browsing URLs/links, shopping, fetching web pages, scheduling/reminders, complex questions, or any task the user asks for help with.

Respond with ONLY a JSON object. For "simple", include a reply. For "escalate", include a brief contextual acknowledgment message (1 sentence, letting the user know you're on it). Examples:
{"action": "ignore"}
{"action": "simple", "reply": "Hi! How can I help you today?"}
{"action": "escalate", "reply": "Let me search for that paper — one moment."}${busyNotice}`;

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
