export type ProgressEvent = {
  type: 'run_started' | 'run_progress' | 'run_completed' | 'run_failed';
  runId: string;
  agentId: string;
  timestamp: string;
  message?: string;
  error?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
};

type ProgressListener = (event: ProgressEvent) => void;

export class ProgressBroadcaster {
  private listeners = new Set<ProgressListener>();

  subscribe(listener: ProgressListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: ProgressListener): void {
    this.listeners.delete(listener);
  }

  emit(event: ProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[websocket] Listener error:', err);
      }
    }
  }
}
