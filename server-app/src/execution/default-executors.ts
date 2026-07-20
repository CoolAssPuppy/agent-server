import { executeAgent } from '../plugins/claude-code.js';
import { executeCodexAgent } from '../plugins/codex.js';
import { executeKimiCodeAgent } from '../plugins/kimi-code.js';
import { ExecutorRegistry } from './executor-registry.js';

/** Create the executor set shared by HTTP, scheduled, chained, and CLI runs. */
export function createDefaultExecutorRegistry(): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register('claude-code', executeAgent);
  registry.register('codex', executeCodexAgent);
  registry.register('kimi-code', executeKimiCodeAgent);
  registry.setDefault('claude-code');
  return registry;
}
