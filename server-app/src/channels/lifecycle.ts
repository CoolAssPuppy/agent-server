export type ChannelName = 'slack' | 'telegram';

export type ChannelLifecycleState =
  | 'not_configured'
  | 'starting'
  | 'connected'
  | 'reconnecting'
  | 'needs_auth'
  | 'disconnected'
  | 'stopped';

export type ChannelErrorCode = 'invalid_auth' | 'conflict' | 'network' | 'startup_timeout' | 'unknown';

export type ChannelLifecycleStatus = {
  channel: ChannelName;
  state: ChannelLifecycleState;
  destination?: 'paired' | 'unpaired';
  error_code?: ChannelErrorCode;
};

export type ChannelStatusListener = (status: ChannelLifecycleStatus) => void;

const ERROR_CODES = new Set<ChannelErrorCode>([
  'invalid_auth',
  'conflict',
  'network',
  'startup_timeout',
  'unknown',
]);

export class ChannelLifecycle {
  private state: ChannelLifecycleState = 'starting';
  private errorCode: ChannelErrorCode | undefined;
  private listeners: ChannelStatusListener[] = [];

  constructor(private readonly channel: ChannelName) {}

  transition(state: ChannelLifecycleState, errorCode?: string): void {
    if (this.state === 'stopped') return;
    this.state = state;
    this.errorCode = errorCode
      ? (ERROR_CODES.has(errorCode as ChannelErrorCode) ? errorCode as ChannelErrorCode : 'unknown')
      : undefined;
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }

  stop(): void {
    this.state = 'stopped';
    this.errorCode = undefined;
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }

  onChange(listener: ChannelStatusListener): void {
    this.listeners.push(listener);
  }

  status(): ChannelLifecycleStatus {
    return {
      channel: this.channel,
      state: this.state,
      ...(this.errorCode ? { error_code: this.errorCode } : {}),
    };
  }
}

export class ChannelReconnectPolicy {
  constructor(
    private readonly initialDelayMs = 1_000,
    private readonly maximumDelayMs = 30_000,
  ) {}

  delay(attempt: number): number {
    if (attempt <= 0) return 0;
    return Math.min(this.initialDelayMs * (2 ** Math.min(attempt - 1, 30)), this.maximumDelayMs);
  }
}
