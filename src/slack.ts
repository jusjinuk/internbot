import { App, LogLevel } from '@slack/bolt';
import type { GenericMessageEvent, BotMessageEvent } from '@slack/types';

import { ASSISTANT_NAME, SLACK_BOT_TOKEN, SLACK_APP_TOKEN } from './config.js';
import { logger } from './logger.js';
import { NewMessage } from './types.js';

const MAX_MESSAGE_LENGTH = 4000;

type HandledMessageEvent = GenericMessageEvent | BotMessageEvent;
type MessageHandler = (msg: NewMessage) => void;

export class SlackConnection {
  private app: App;
  private botUserId: string | undefined;
  private connected = false;
  private handler: MessageHandler | undefined;
  private userNameCache = new Map<string, string>();

  constructor() {
    if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
      throw new Error(
        'SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set in .env',
      );
    }

    this.app = new App({
      token: SLACK_BOT_TOKEN,
      appToken: SLACK_APP_TOKEN,
      socketMode: true,
      logLevel: LogLevel.ERROR,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.app.event('message', async ({ event }) => {
      const subtype = (event as { subtype?: string }).subtype;
      if (subtype && subtype !== 'bot_message') return;

      const msg = event as HandledMessageEvent;
      if (!msg.text) return;

      const isBotMessage = !!msg.bot_id || msg.user === this.botUserId;

      let senderName: string;
      if (isBotMessage) {
        senderName = ASSISTANT_NAME;
      } else {
        senderName =
          (msg.user ? await this.resolveUserName(msg.user) : undefined) ||
          msg.user ||
          'unknown';
      }

      // Translate <@BOTID> mentions to @assistantname
      let content = msg.text;
      if (this.botUserId && !isBotMessage) {
        const mentionPattern = `<@${this.botUserId}>`;
        if (content.includes(mentionPattern)) {
          content = content.replace(
            new RegExp(`<@${this.botUserId}>`, 'g'),
            `@${ASSISTANT_NAME}`,
          );
        }
      }

      const channelType = msg.channel_type as
        | 'im'
        | 'mpim'
        | 'channel'
        | 'group'
        | undefined;

      const newMsg: NewMessage = {
        id: msg.ts,
        channel_id: msg.channel,
        sender: msg.user || msg.bot_id || '',
        sender_name: senderName,
        content,
        timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString(),
        is_from_me: isBotMessage,
        is_bot_message: isBotMessage,
        thread_ts: (msg as GenericMessageEvent).thread_ts,
        channel_type: channelType,
      };

      this.handler?.(newMsg);
    });
  }

  async connect(): Promise<void> {
    await this.app.start();

    try {
      const auth = await this.app.client.auth.test();
      this.botUserId = auth.user_id as string;
      logger.info({ botUserId: this.botUserId }, 'Connected to Slack');
    } catch (err) {
      logger.warn({ err }, 'Connected to Slack but failed to get bot user ID');
    }

    this.connected = true;
  }

  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(
    channelId: string,
    text: string,
    threadTs?: string,
  ): Promise<void> {
    if (!this.connected) {
      logger.warn({ channelId }, 'Slack not connected, dropping message');
      return;
    }

    try {
      if (text.length <= MAX_MESSAGE_LENGTH) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text,
          thread_ts: threadTs,
        });
      } else {
        for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: text.slice(i, i + MAX_MESSAGE_LENGTH),
            thread_ts: threadTs,
          });
        }
      }
    } catch (err) {
      logger.error({ channelId, err }, 'Failed to send Slack message');
    }
  }

  async addReaction(
    channelId: string,
    timestamp: string,
    emoji: string,
  ): Promise<void> {
    try {
      await this.app.client.reactions.add({
        channel: channelId,
        timestamp,
        name: emoji,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to add reaction');
    }
  }

  async removeReaction(
    channelId: string,
    timestamp: string,
    emoji: string,
  ): Promise<void> {
    try {
      await this.app.client.reactions.remove({
        channel: channelId,
        timestamp,
        name: emoji,
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to remove reaction');
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.app.stop();
  }

  private async resolveUserName(
    userId: string,
  ): Promise<string | undefined> {
    if (!userId) return undefined;

    const cached = this.userNameCache.get(userId);
    if (cached) return cached;

    try {
      const result = await this.app.client.users.info({ user: userId });
      const name = result.user?.real_name || result.user?.name;
      if (name) this.userNameCache.set(userId, name);
      return name;
    } catch {
      return undefined;
    }
  }
}
