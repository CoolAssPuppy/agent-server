const MAX_INTERACTIONS = 1_000;
export class InteractionStore {
    interactions = new Map();
    add(input) {
        this.interactions.set(input.id, { ...input, status: 'pending' });
        this.evictOldestIfNeeded();
    }
    get(id) {
        return this.interactions.get(id);
    }
    markActed(id) {
        const interaction = this.interactions.get(id);
        if (interaction) {
            this.interactions.set(id, { ...interaction, status: 'acted' });
        }
    }
    expireStale() {
        const now = new Date();
        const expired = [];
        for (const [id, interaction] of this.interactions) {
            if (interaction.status === 'pending' && interaction.expiresAt <= now) {
                this.interactions.set(id, { ...interaction, status: 'expired' });
                expired.push(id);
            }
            if (interaction.status !== 'pending' && now.getTime() - interaction.createdAt.getTime() > 24 * 60 * 60 * 1000) {
                this.interactions.delete(id);
            }
        }
        return expired;
    }
    listPending() {
        return [...this.interactions.values()].filter((i) => i.status === 'pending');
    }
    evictOldestIfNeeded() {
        if (this.interactions.size <= MAX_INTERACTIONS)
            return;
        const entries = [...this.interactions.entries()]
            .sort(([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime());
        const removeCount = this.interactions.size - MAX_INTERACTIONS;
        for (const [id] of entries.slice(0, removeCount)) {
            this.interactions.delete(id);
        }
    }
}
//# sourceMappingURL=store.js.map