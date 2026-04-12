import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';
import type { Channel, ReplyCallback } from './channel.js';
export declare function formatInteraction(request: InteractionRequest): string;
type SelectionResult = {
    selectedValue: string;
} | {
    freeText: string;
};
export declare function resolveSelection(input: string, request: InteractionRequest): SelectionResult | undefined;
export declare class ConsoleChannel implements Channel {
    readonly name = "console";
    private callbacks;
    start(): Promise<void>;
    stop(): Promise<void>;
    onReply(callback: ReplyCallback): void;
    notify(data: NotificationData): Promise<number | undefined>;
    send(interactionId: string, request: InteractionRequest): Promise<void>;
}
export {};
//# sourceMappingURL=console.d.ts.map