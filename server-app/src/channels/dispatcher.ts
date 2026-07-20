import type { Channel } from './channel.js';
import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';

class ChannelUnavailableError extends Error {
  constructor(channelName: string) {
    super(`Channel not configured: ${channelName}`);
    this.name = 'ChannelUnavailableError';
  }
}

export class ChannelDispatcher {
  private channels = new Map<string, Channel>();

  register(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  resolve(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  private resolveOrWarn(channelName: string, context: string): Channel | undefined {
    const channel = this.channels.get(channelName);
    if (!channel) {
      console.warn(`Channel not configured: ${channelName} (${context} will not be delivered)`);
    }
    return channel;
  }

  async dispatch(
    interactionId: string,
    channelName: string,
    request: InteractionRequest,
  ): Promise<void> {
    const channel = this.resolveOrWarn(channelName, `interaction ${interactionId}`);
    if (!channel) throw new ChannelUnavailableError(channelName);
    await channel.send(interactionId, request);
  }

  async notify(channelName: string, data: NotificationData): Promise<number | undefined> {
    const channel = this.resolveOrWarn(channelName, 'notification');
    if (!channel) return undefined;
    return channel.notify(data);
  }

  async expireInteractions(expired: Array<{ id: string; channel: string }>): Promise<void> {
    for (const { id, channel: channelName } of expired) {
      const channel = this.channels.get(channelName);
      if (channel?.expireInteraction) {
        await channel.expireInteraction(id);
      }
    }
  }

  async startAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
  }
}
