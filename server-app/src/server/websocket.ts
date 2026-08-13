import type { ProgressEvent } from './progress-event.js';
import { sanitizeProgressEvent } from './security-utils.js';

export type { ProgressEvent };

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
    const safeEvent = sanitizeProgressEvent(event);
    for (const listener of this.listeners) {
      try {
        listener(safeEvent);
      } catch (err) {
        console.error('[websocket] Listener error:', err);
      }
    }
  }
}
