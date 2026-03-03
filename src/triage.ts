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
      return { action: 'escalate' };
    }
    return { action: 'ignore' };
  } catch {
    return { action: 'ignore' };
  }
}

/**
 * Two-layer triage:
 * 1. Free string match for bot mention (channels only)
 * 2. Haiku API call for classification
 */
export async function triage(
  msg: NewMessage,
  recentContext: NewMessage[],
  isDm: boolean,
): Promise<TriageResult> {
  // Layer 1: free check — in channels, ignore if bot not mentioned
  if (!isDm && !isBotMentioned(msg.content)) {
    return { action: 'ignore' };
  }

  // Layer 2: Haiku API call
  const skills = discoverSkills();
  const contextLines = recentContext
    .slice(-5)
    .map((m) => `${m.sender_name}: ${m.content}`)
    .join('\n');

  const systemPrompt = `You are a triage classifier for ${ASSISTANT_NAME}, a research assistant bot in Slack.

Available skills: ${skills.join(', ') || 'none'}
Message is from: ${isDm ? 'a direct message' : 'a channel where the bot was mentioned'}

Classify the user's message into one of:
- "ignore": not directed at the bot, human chatter, or messages that don't need a response
- "simple": greeting, acknowledgment, or a question answerable in 1-2 sentences without tools
- "escalate": paper search, code review, brainstorming, report writing, web search, complex questions, anything requiring tools or detailed analysis

Respond with ONLY a JSON object. For "simple", include a reply. Examples:
{"action": "ignore"}
{"action": "simple", "reply": "Hi! How can I help you today?"}
{"action": "escalate"}`;

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
