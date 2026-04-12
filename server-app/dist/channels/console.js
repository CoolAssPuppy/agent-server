import { createInterface } from 'readline';
import { formatPlainNotification } from '../interaction/notification.js';
export function formatInteraction(request) {
    const lines = [`\n${request.message}\n`];
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
export function resolveSelection(input, request) {
    const trimmed = input.trim();
    if (!trimmed)
        return undefined;
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
export class ConsoleChannel {
    name = 'console';
    callbacks = [];
    async start() { }
    async stop() { }
    onReply(callback) {
        this.callbacks.push(callback);
    }
    async notify(data) {
        const message = formatPlainNotification(data);
        console.log(`\n[notification] ${message}\n`);
        return undefined;
    }
    async send(interactionId, request) {
        const formatted = formatInteraction(request);
        process.stdout.write(formatted);
        const prompt = request.options ? 'Select an option: ' : 'Your reply: ';
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        return new Promise((resolve) => {
            rl.question(prompt, (answer) => {
                rl.close();
                const result = resolveSelection(answer, request);
                if (!result) {
                    console.log('Invalid selection.');
                    resolve();
                    return;
                }
                const reply = {
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
//# sourceMappingURL=console.js.map