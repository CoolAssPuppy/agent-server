import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';

export type ChannelReply = {
  interactionId: string;
  selectedValue?: string;
  freeText?: string;
};

export type ReplyCallback = (reply: ChannelReply) => void;

export interface Channel {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(interactionId: string, request: InteractionRequest): Promise<void>;
  notify(data: NotificationData): Promise<void>;
  onReply(callback: ReplyCallback): void;
  expireInteraction?(interactionId: string): Promise<void>;
}
