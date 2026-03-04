import {
  query,
  type HookCallback,
  type PreToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';

import {
  AGENT_MODEL,
  ASSISTANT_NAME,
} from './config.js';
import { getSession, setSession } from './db.js';
import { logger } from './logger.js';
import { AgentResult } from './types.js';

const SECRET_ENV_VARS = ['CLAUDE_CODE_OAUTH_TOKEN'];

function createSanitizeBashHook(): HookCallback {
  return async (input) => {
    const preInput = input as PreToolUseHookInput;
    const command = (preInput.tool_input as { command?: string })?.command;
    if (!command) return {};

    const unsetPrefix = `unset ${SECRET_ENV_VARS.join(' ')} 2>/dev/null; `;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: {
          ...(preInput.tool_input as Record<string, unknown>),
          command: unsetPrefix + command,
        },
      },
    };
  };
}

export async function runAgent(
  prompt: string,
  channelId: string,
): Promise<AgentResult> {
  const sessionId = getSession(channelId);

  const sdkEnv: Record<string, string | undefined> = { ...process.env };

  let newSessionId: string | undefined;
  let resultText = '';

  try {
    for await (const message of query({
      prompt,
      options: {
        model: AGENT_MODEL,
        cwd: process.cwd(),
        resume: sessionId,
        systemPrompt: {
          type: 'preset' as const,
          preset: 'claude_code' as const,
          append: `You are ${ASSISTANT_NAME}, a helpful assistant bot for a lab's Slack workspace. You specialize in research tasks (papers, code, reports) but should also help with any reasonable request from lab members. Format responses for Slack (plain text, no markdown headers). Keep responses concise and actionable.`,
        },
        allowedTools: [
          'Bash',
          'Read',
          'Write',
          'Edit',
          'Glob',
          'Grep',
          'WebSearch',
          'WebFetch',
          'mcp__arxiv__*',
          'mcp__context7__*',
          'mcp__time__*',
          'mcp__hf_papers__*',
        ],
        env: sdkEnv,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: {
          arxiv: {
            command: 'npx',
            args: ['-y', '@langgpt/arxiv-paper-mcp@latest'],
          },
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
          },
          time: {
            command: 'npx',
            args: ['-y', '@mcpcentral/mcp-time'],
          },
          hf_papers: {
            command: 'uvx',
            args: ['huggingface-daily-paper-mcp'],
          },
        },
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [createSanitizeBashHook()] },
          ],
        },
      },
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        newSessionId = message.session_id;
      }

      if (message.type === 'result') {
        const text =
          'result' in message
            ? (message as { result?: string }).result
            : null;
        if (text) {
          resultText += (resultText ? '\n' : '') + text;
        }
      }
    }
  } catch (err) {
    logger.error({ err, channelId }, 'Agent query failed');
    resultText = resultText || 'Sorry, I encountered an error processing your request.';
  }

  const finalSessionId = newSessionId || sessionId;
  if (finalSessionId) {
    setSession(channelId, finalSessionId);
  }

  return {
    text: resultText || 'I processed your request but have nothing to report.',
    sessionId: finalSessionId,
  };
}
