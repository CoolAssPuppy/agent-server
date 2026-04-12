import type { Channel } from './channel.js';
import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';
export declare class ChannelDispatcher {
    private channels;
    register(channel: Channel): void;
    resolve(name: string): Channel | undefined;
    private resolveOrWarn;
    dispatch(interactionId: string, channelName: string, request: InteractionRequest): Promise<void>;
    notify(channelName: string, data: NotificationData): Promise<number | undefined>;
    expireInteractions(expired: Array<{
        id: string;
        channel: string;
    }>): Promise<void>;
    startAll(): Promise<void>;
    stopAll(): Promise<void>;
}
//# sourceMappingURL=dispatcher.d.ts.map