import type { Channel } from './channel.js';
import type { InteractionRequest } from '../interaction/schema.js';

export class ChannelDispatcher {
  private channels = new Map<string, Channel>();

  register(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  resolve(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  async dispatch(
    interactionId: string,
    channelName: string,
    request: InteractionRequest,
  ): Promise<void> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      console.warn(`Channel not configured: ${channelName} (interaction ${interactionId} will not be delivered)`);
      return;
    }
    await channel.send(interactionId, request);
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
