import { describe, expect, it } from 'vitest';
import { makeAgent, makeExecutionResult } from '../test-factories.js';
import {
  assertRequiredOutput,
  OUTPUT_CONTRACT_UNMET_CODE,
  OutputContractError,
} from './output-contract.js';

function requiredOutput(overrides: Record<string, unknown> = {}) {
  return {
    primary: {
      description: 'Create the report in the approved workspace',
      tool: 'mcp__notion__create_page',
      required: true,
      successful_calls: { min: 1, max: 1 },
      target_match: { field: 'data_source_id', equals: 'private-destination-id' },
      ...overrides,
    },
  };
}

describe('required agent output', () => {
  it('accepts an exact successful tool call to a recursively nested target', () => {
    const agent = makeAgent({ output: requiredOutput() });
    const execution = makeExecutionResult({
      toolCalls: [{
        name: 'mcp__notion__create_page',
        status: 'succeeded',
        input: { parent: { data_source_id: 'private-destination-id' } },
      }],
    });

    expect(() => assertRequiredOutput(agent, execution)).not.toThrow();
  });

  it('accepts the reviewed update tool as an alternative output action', () => {
    const agent = makeAgent({ output: requiredOutput({ update_tool: 'mcp__notion__update_page' }) });
    const execution = makeExecutionResult({
      toolCalls: [{
        name: 'mcp__notion__update_page',
        status: 'succeeded',
        input: { data_source_id: 'private-destination-id' },
      }],
    });

    expect(() => assertRequiredOutput(agent, execution)).not.toThrow();
  });

  it('accepts normalized portable operation evidence for a logical resource', () => {
    const agent = makeAgent({
      output: {
        primary: {
          description: 'Create the report',
          use: 'work_notes',
          operation: 'notion.page.create',
          target: 'report_database',
          required: true,
          successful_calls: { min: 1, max: 1 },
        },
      },
    });
    const trace = Object.assign(
      { name: 'mcp__local_notion__API-post-page', status: 'succeeded' as const },
      {
        portable: {
          use: 'work_notes',
          operation: 'notion.page.create',
          target: 'report_database',
        },
      },
    );

    expect(() => assertRequiredOutput(
      agent,
      makeExecutionResult({ toolCalls: [trace] }),
    )).not.toThrow();
  });

  it('does not enforce advisory output or safe tests', () => {
    const advisory = makeAgent({ output: requiredOutput({ required: false }) });
    const required = makeAgent({ output: requiredOutput() });
    const execution = makeExecutionResult({ toolCalls: [] });

    expect(() => assertRequiredOutput(advisory, execution)).not.toThrow();
    expect(() => assertRequiredOutput(required, execution, { mode: 'safe_test' })).not.toThrow();
  });

  it('fails when an advisory output was attempted but the service rejected it', () => {
    const advisory = makeAgent({ output: requiredOutput({ required: false }) });
    const execution = makeExecutionResult({
      toolCalls: [{
        name: 'mcp__notion__create_page',
        status: 'failed',
        input: { data_source_id: 'private-destination-id' },
      }],
    });

    expect(() => assertRequiredOutput(advisory, execution)).toThrow(
      'service reported a failure',
    );
  });

  it.each([
    {
      name: 'the required tool was not used',
      toolCalls: [],
      message: 'The agent finished without creating its required output.',
    },
    {
      name: 'the service reported failure',
      toolCalls: [{
        name: 'mcp__notion__create_page',
        status: 'failed' as const,
        input: { data_source_id: 'private-destination-id' },
        output: 'secret service response',
      }],
      message: 'The agent tried to create its required output, but the service reported a failure.',
    },
    {
      name: 'the approved target was not used',
      toolCalls: [{
        name: 'mcp__notion__create_page',
        status: 'succeeded' as const,
        input: { data_source_id: 'different-private-id' },
      }],
      message: 'The agent used the output service, but not the approved destination.',
    },
  ])('returns a stable, redacted error when $name', ({ toolCalls, message }) => {
    const agent = makeAgent({ output: requiredOutput() });

    expect(() => assertRequiredOutput(agent, makeExecutionResult({ toolCalls }))).toThrowError(
      expect.objectContaining({ code: OUTPUT_CONTRACT_UNMET_CODE, message }),
    );
    try {
      assertRequiredOutput(agent, makeExecutionResult({ toolCalls }));
    } catch (error) {
      expect(error).toBeInstanceOf(OutputContractError);
      expect(String(error)).not.toContain('private-destination-id');
      expect(String(error)).not.toContain('different-private-id');
      expect(String(error)).not.toContain('secret service response');
    }
  });

  it('enforces the reviewed successful-call range', () => {
    const agent = makeAgent({ output: requiredOutput({
      successful_calls: { min: 2, max: 2 },
      target_match: undefined,
    }) });
    const oneCall = makeExecutionResult({
      toolCalls: [{ name: 'mcp__notion__create_page', status: 'succeeded' }],
    });
    const threeCalls = makeExecutionResult({
      toolCalls: [
        { name: 'mcp__notion__create_page', status: 'succeeded' },
        { name: 'mcp__notion__create_page', status: 'succeeded' },
        { name: 'mcp__notion__create_page', status: 'succeeded' },
      ],
    });

    expect(() => assertRequiredOutput(agent, oneCall)).toThrow('fewer required outputs');
    expect(() => assertRequiredOutput(agent, threeCalls)).toThrow('more outputs than the configured limit');
  });
});
