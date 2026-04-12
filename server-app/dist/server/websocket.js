export class ProgressBroadcaster {
    listeners = new Set();
    subscribe(listener) {
        this.listeners.add(listener);
    }
    unsubscribe(listener) {
        this.listeners.delete(listener);
    }
    emit(event) {
        for (const listener of this.listeners) {
            try {
                listener(event);
            }
            catch (err) {
                console.error('[websocket] Listener error:', err);
            }
        }
    }
}
//# sourceMappingURL=websocket.js.map