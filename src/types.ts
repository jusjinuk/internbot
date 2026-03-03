export interface NewMessage {
  id: string;
  channel_id: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  thread_ts?: string;
  channel_type?: 'im' | 'mpim' | 'channel' | 'group';
}

export interface TriageResult {
  action: 'ignore' | 'simple' | 'escalate';
  reply?: string;
}

export interface AgentResult {
  text: string;
  sessionId?: string;
}
