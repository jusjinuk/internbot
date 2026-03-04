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
  action: 'ignore' | 'simple' | 'escalate' | 'schedule' | 'schedule_manage';
  reply?: string;
  schedule?: {
    prompt: string;
    type: 'once' | 'cron';
    value: string; // ISO timestamp for once, cron expression for cron
  };
  manage?: {
    operation: 'list' | 'cancel' | 'update';
    taskId?: string;
    updates?: {
      prompt?: string;
      schedule_value?: string;
    };
  };
}

export interface ScheduledTask {
  id: string;
  channel_id: string;
  created_by: string;
  prompt: string;
  schedule_type: 'once' | 'cron';
  schedule_value: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'completed' | 'cancelled';
  created_at: string;
}

export interface TaskRunLog {
  id: number;
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

export interface AgentResult {
  text: string;
  sessionId?: string;
}
