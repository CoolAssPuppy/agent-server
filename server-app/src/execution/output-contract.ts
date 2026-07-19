import type { AgentConfig } from '../agents/config.js';
import type { ExecutionResult, ToolCallTrace } from './executor.js';

export const OUTPUT_CONTRACT_UNMET_CODE = 'output_contract_unmet';

export type OutputContractFailureReason =
  | 'missing_tool'
  | 'tool_failed'
  | 'wrong_target'
  | 'too_few'
  | 'too_many';

const FAILURE_MESSAGES: Record<OutputContractFailureReason, string> = {
  missing_tool: 'The agent finished without creating its required output.',
  tool_failed: 'The agent tried to create its required output, but the service reported a failure.',
  wrong_target: 'The agent used the output service, but not the approved destination.',
  too_few: 'The agent created fewer required outputs than expected.',
  too_many: 'The agent created more outputs than the configured limit.',
};

export class OutputContractError extends Error {
  readonly code = OUTPUT_CONTRACT_UNMET_CODE;

  constructor(readonly reason: OutputContractFailureReason) {
    super(FAILURE_MESSAGES[reason]);
    this.name = 'OutputContractError';
  }
}

type ValidationOptions = {
  mode?: 'normal' | 'safe_test';
};

/**
 * Confirm that a required external output was actually produced before a run
 * can be recorded as complete. Tool payloads are inspected in memory only and
 * never copied into the resulting error.
 */
export function assertRequiredOutput(
  agent: AgentConfig,
  result: ExecutionResult,
  options: ValidationOptions = {},
): void {
  const contract = agent.output?.primary;
  if (options.mode === 'safe_test' || contract?.required !== true) return;

  const allowedNames = new Set([
    contract.tool,
    ...(contract.update_tool ? [contract.update_tool] : []),
  ]);
  const attempts = (result.toolCalls ?? []).filter((call) => allowedNames.has(call.name));
  if (attempts.length === 0) throw new OutputContractError('missing_tool');

  const succeeded = attempts.filter((call) => call.status === 'succeeded');
  if (succeeded.length === 0) throw new OutputContractError('tool_failed');

  const matching = contract.target_match
    ? succeeded.filter((call) => callMatchesTarget(call, contract.target_match!))
    : succeeded;
  if (contract.target_match && matching.length === 0) {
    throw new OutputContractError('wrong_target');
  }

  const minimum = contract.successful_calls?.min ?? 1;
  if (matching.length < minimum) throw new OutputContractError('too_few');
  const maximum = contract.successful_calls?.max;
  if (maximum !== undefined && matching.length > maximum) {
    throw new OutputContractError('too_many');
  }
}

function callMatchesTarget(
  call: ToolCallTrace,
  target: { field: string; equals: string | number | boolean },
): boolean {
  return containsFieldValue(call.input, target.field, target.equals, new WeakSet(), 0);
}

function containsFieldValue(
  value: unknown,
  field: string,
  expected: string | number | boolean,
  visited: WeakSet<object>,
  depth: number,
): boolean {
  if (depth > 32 || typeof value !== 'object' || value === null) return false;
  if (visited.has(value)) return false;
  visited.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) => containsFieldValue(entry, field, expected, visited, depth + 1));
  }

  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, field) && Object.is(record[field], expected)) return true;
  return Object.values(record).some((entry) =>
    containsFieldValue(entry, field, expected, visited, depth + 1));
}
