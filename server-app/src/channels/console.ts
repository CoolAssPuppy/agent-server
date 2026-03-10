import { createInterface } from 'readline';
import type { InteractionRequest } from '../interaction/schema.js';
import type { NotificationData } from '../interaction/notification.js';
import { formatPlainNotification } from '../interaction/notification.js';
import type { Channel, ChannelReply, ReplyCallback } from './channel.js';

export function formatInteraction(request: InteractionRequest): string {
  const lines: string[] = [`\n${request.message}\n`];

  if (request.options) {
    for (let i = 0; i < request.options.length; i++) {
      const opt = request.options[i];
      const desc = opt.description ? ` - ${opt.description}` : '';
      lines.push(`  ${i + 1}) ${opt.label}${desc}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

type SelectionResult = { selectedValue: string } | { freeText: string };

export function resolveSelection(
  input: string,
  request: InteractionRequest,
): SelectionResult | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  if (request.options) {
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= request.options.length) {
      return { selectedValue: request.options[num - 1].value };
    }
  }

  if (request.freeText) {
    return { freeText: trimmed };
  }

  return undefined;
}

export class ConsoleChannel implements Channel {
  readonly name = 'console';
  private callbacks: ReplyCallback[] = [];

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  onReply(callback: ReplyCallback): void {
    this.callbacks.push(callback);
  }

  async notify(data: NotificationData): Promise<void> {
    const message = formatPlainNotification(data);
    console.log(`\n[notification] ${message}\n`);
  }

  async send(interactionId: string, request: InteractionRequest): Promise<void> {
    const formatted = formatInteraction(request);
    process.stdout.write(formatted);

    const prompt = request.options ? 'Select an option: ' : 'Your reply: ';

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<void>((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();

        const result = resolveSelection(answer, request);
        if (!result) {
          console.log('Invalid selection.');
          resolve();
          return;
        }

        const reply: ChannelReply = {
          interactionId,
          ...result,
        };

        for (const cb of this.callbacks) {
          cb(reply);
        }

        resolve();
      });
    });
  }
}
