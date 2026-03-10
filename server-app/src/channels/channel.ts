import type { InteractionRequest } from '../interaction/schema.js';

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
  notify(message: string): Promise<void>;
  onReply(callback: ReplyCallback): void;
  expireInteraction?(interactionId: string): Promise<void>;
}
