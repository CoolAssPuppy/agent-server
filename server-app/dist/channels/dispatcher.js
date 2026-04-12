export class ChannelDispatcher {
    channels = new Map();
    register(channel) {
        this.channels.set(channel.name, channel);
    }
    resolve(name) {
        return this.channels.get(name);
    }
    resolveOrWarn(channelName, context) {
        const channel = this.channels.get(channelName);
        if (!channel) {
            console.warn(`Channel not configured: ${channelName} (${context} will not be delivered)`);
        }
        return channel;
    }
    async dispatch(interactionId, channelName, request) {
        const channel = this.resolveOrWarn(channelName, `interaction ${interactionId}`);
        if (!channel)
            return;
        await channel.send(interactionId, request);
    }
    async notify(channelName, data) {
        const channel = this.resolveOrWarn(channelName, 'notification');
        if (!channel)
            return undefined;
        return channel.notify(data);
    }
    async expireInteractions(expired) {
        for (const { id, channel: channelName } of expired) {
            const channel = this.channels.get(channelName);
            if (channel?.expireInteraction) {
                await channel.expireInteraction(id);
            }
        }
    }
    async startAll() {
        for (const channel of this.channels.values()) {
            await channel.start();
        }
    }
    async stopAll() {
        for (const channel of this.channels.values()) {
            await channel.stop();
        }
    }
}
//# sourceMappingURL=dispatcher.js.map