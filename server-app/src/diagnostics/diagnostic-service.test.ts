import { describe, expect, it } from 'vitest';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import {
  analyzeRunFailure,
  buildDiagnosticPrompt,
  guardRepairProposal,
  type DiagnosticModel,
} from './diagnostic-service.js';

describe('guided run diagnostics', () => {
  it.each([
    {
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true, runAlreadyActive: true },
      summary: 'This agent is already running.',
    },
    {
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true, invalidSchedule: true },
      summary: 'This agent has an invalid run time.',
    },
    {
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true, notificationReady: false },
      summary: 'The result could not be delivered.',
      agent: makeAgent({ notification: { channel: 'telegram', on_complete: true, on_failure: true } }),
    },
    {
      readiness: {
        serverOnline: true,
        runtimeAvailable: true,
        workingDirectoryExists: true,
        expectedOutputMissing: '~/Documents/report.md',
      },
      summary: 'The run finished without creating the expected result.',
    },
  ])('explains $summary with a local check', async ({ readiness, summary, agent }) => {
    const result = await analyzeRunFailure({
      agent: agent ?? makeAgent(),
      run: makeStoredRun({ status: 'failed', error: 'Failure' }),
      readiness,
    });

    expect(result.summary).toBe(summary);
    expect(result.source).toBe('deterministic');
  });

  it('explains a write permission mismatch without calling a model', async () => {
    let modelCalled = false;
    const result = await analyzeRunFailure({
      agent: makeAgent({ tools: ['Read'], working_directory: '~/Documents/Reports' }),
      run: makeStoredRun({
        status: 'failed',
        error: 'Write permission denied',
        filesWritten: ['~/Documents/Reports/weekly.md'],
      }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
      model: { generate: async () => { modelCalled = true; return {}; } },
    });

    expect(result.source).toBe('deterministic');
    expect(result.summary).toBe('This agent tried to save a file, but file editing is turned off.');
    expect(result.suggested_fix.label).toBe('Review file editing access');
    expect(result.rerun_safety).toBe('confirm');
    expect(modelCalled).toBe(false);
  });

  it('prioritizes a missing required connection and keeps credentials out of evidence', async () => {
    const result = await analyzeRunFailure({
      agent: makeAgent(),
      run: makeStoredRun({ status: 'failed', error: 'SLACK_BOT_TOKEN=secret-token-value is missing' }),
      readiness: {
        serverOnline: true,
        runtimeAvailable: true,
        workingDirectoryExists: true,
        missingConnections: ['Slack'],
      },
    });

    expect(result.most_likely_cause).toContain('Slack');
    expect(JSON.stringify(result.evidence)).not.toContain('secret-token-value');
    expect(result.suggested_fix.kind).toBe('connect');
  });

  it('maps a known runtime error to a friendly heuristic diagnosis', async () => {
    const result = await analyzeRunFailure({
      agent: makeAgent(),
      run: makeStoredRun({ status: 'failed', error: 'spawn codex ENOENT' }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
    });

    expect(result.source).toBe('heuristic');
    expect(result.summary).toBe('The selected agent runtime could not be started.');
    expect(result.suggested_fix.label).toBe('Use an available runtime');
  });

  it('uses a redacted model package only after local checks find no answer', async () => {
    let receivedPrompt = '';
    const modelResult = {
      schema_version: 1,
      run_id: 'run-1',
      summary: 'The service returned an unexpected response.',
      most_likely_cause: 'The response format changed.',
      confidence: 0.62,
      evidence: [{
        code: 'unexpected-response',
        label: 'Unexpected response',
        detail: 'The run ended after receiving an unsupported response.',
        source: 'run',
      }],
      suggested_fix: {
        id: 'retry-service',
        label: 'Retry the service',
        description: 'Try again without changing permissions.',
        kind: 'retry',
        risk: 'low',
        requires_confirmation: false,
        affects_functionality: false,
      },
      affected_settings: [],
      risk: 'low',
      can_automate: false,
      rerun_safety: 'safe',
      alternatives: ['The service may be temporarily unavailable.'],
      next_step: 'Retry the run.',
      source: 'model',
    };
    const model: DiagnosticModel = {
      generate: async (prompt) => { receivedPrompt = prompt; return modelResult; },
    };

    const result = await analyzeRunFailure({
      agent: makeAgent({ prompt: 'Call the service with token="secret-token-value".' }),
      run: makeStoredRun({ status: 'failed', error: 'Unexpected response token="secret-token-value"' }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
      model,
    });

    expect(result.source).toBe('model');
    expect(receivedPrompt).not.toContain('secret-token-value');
    expect(receivedPrompt).not.toContain('Call the service');
  });

  it('falls back to a local manual diagnosis for malformed model output', async () => {
    const result = await analyzeRunFailure({
      agent: makeAgent(),
      run: makeStoredRun({ status: 'failed', error: 'Unclassified failure' }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
      model: { generate: async () => ({ made_up: true }) },
    });

    expect(result).toMatchObject({
      source: 'deterministic',
      confidence: 0,
      can_automate: false,
      rerun_safety: 'confirm',
    });
  });

  it('retries one malformed diagnostic response before using a valid result', async () => {
    let calls = 0;
    const valid = {
      schema_version: 1,
      run_id: 'run-1',
      summary: 'The response format changed.',
      most_likely_cause: 'The service returned a new response shape.',
      confidence: 0.6,
      evidence: [{
        code: 'response-shape',
        label: 'Response changed',
        detail: 'The response was not in the expected format.',
        source: 'run',
      }],
      suggested_fix: {
        id: 'retry',
        label: 'Retry the service',
        description: 'Retry without changing access.',
        kind: 'retry',
        risk: 'low',
        requires_confirmation: false,
        affects_functionality: false,
      },
      affected_settings: [],
      risk: 'low',
      can_automate: false,
      rerun_safety: 'safe',
      alternatives: [],
      next_step: 'Retry the run.',
      source: 'model',
    };

    const result = await analyzeRunFailure({
      agent: makeAgent(),
      run: makeStoredRun({ status: 'failed', error: 'Unclassified failure' }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
      model: { generate: async () => (++calls === 1 ? { invalid: true } : valid) },
    });

    expect(result.source).toBe('model');
    expect(calls).toBe(2);
  });

  it('rejects automated repairs that broaden dangerous access', () => {
    const guarded = guardRepairProposal({
      summary: 'Grant broad access.',
      operations: [{ field: 'codex_sandbox', value: 'danger-full-access' }],
      risk: 'critical',
      rerun_after_apply: true,
    });

    expect(guarded.can_automate).toBe(false);
    expect(guarded.requires_confirmation).toBe(true);
    expect(guarded.rejected_reasons).toContain('Unrestricted file access cannot be applied automatically.');
  });

  it('rejects wildcard permissions and home-root changes from automated repairs', () => {
    const wildcard = guardRepairProposal({
      summary: 'Allow all tools.',
      operations: [{ field: 'permissions', value: { allow: ['*'], deny: [] } }],
      risk: 'low',
      rerun_after_apply: true,
    });
    const filesystemRoot = guardRepairProposal({
      summary: 'Use the filesystem root.',
      operations: [{ field: 'working_directory', value: '/' }],
      risk: 'low',
      rerun_after_apply: true,
    });

    expect(wildcard.can_automate).toBe(false);
    expect(filesystemRoot.can_automate).toBe(false);
  });

  it('requires review before a repair adds file editing through either permission format', () => {
    const toolList = guardRepairProposal({
      summary: 'Add file editing.',
      operations: [{ field: 'tools', value: ['Read', 'Write'] }],
      risk: 'low',
      rerun_after_apply: true,
    });
    const permissionList = guardRepairProposal({
      summary: 'Add file editing.',
      operations: [{ field: 'permissions', value: { allow: ['Read', 'Edit'], deny: [] } }],
      risk: 'low',
      rerun_after_apply: true,
    });

    expect(toolList.can_automate).toBe(false);
    expect(permissionList.can_automate).toBe(false);
    expect(permissionList.requires_confirmation).toBe(true);
  });

  it('does not trust a model that labels a high-risk automated fix as safe', async () => {
    const result = await analyzeRunFailure({
      agent: makeAgent(),
      run: makeStoredRun({ status: 'failed', error: 'Unclassified failure' }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
      model: {
        generate: async () => ({
          schema_version: 1,
          run_id: 'run-1',
          summary: 'Add command access.',
          most_likely_cause: 'A command was unavailable.',
          confidence: 0.5,
          evidence: [{ code: 'claim', label: 'Claim', detail: 'No verified command evidence.', source: 'model' }],
          suggested_fix: {
            id: 'add-command',
            label: 'Add command access',
            description: 'Allow commands.',
            kind: 'configuration_patch',
            risk: 'high',
            requires_confirmation: false,
            affects_functionality: true,
          },
          affected_settings: ['Commands'],
          risk: 'high',
          can_automate: true,
          rerun_safety: 'safe',
          alternatives: [],
          next_step: 'Apply automatically.',
          source: 'model',
        }),
      },
    });

    expect(result.source).toBe('deterministic');
    expect(result.can_automate).toBe(false);
  });

  it('allows a narrow low-risk runtime repair to be reviewed and applied', () => {
    const guarded = guardRepairProposal({
      summary: 'Use the installed runtime.',
      operations: [{ field: 'executor', value: 'codex' }],
      risk: 'low',
      rerun_after_apply: true,
    });

    expect(guarded.can_automate).toBe(true);
    expect(guarded.requires_confirmation).toBe(false);
    expect(guarded.rejected_reasons).toEqual([]);
  });

  it('validates exact native grants and requires review before changing personal access', () => {
    const guarded = guardRepairProposal({
      summary: 'Read names from the selected Contacts group.',
      operations: [{
        field: 'native_services',
        value: {
          contacts: {
            resources: [{ id: 'family', name: 'Family', actions: ['read'], fields: ['name'] }],
          },
        },
      }],
      risk: 'needs_review',
      rerun_after_apply: true,
    });

    expect(guarded.can_automate).toBe(true);
    expect(guarded.requires_confirmation).toBe(true);
  });

  it('rejects model repairs that hide broad paths or native changes behind low risk', () => {
    const fileRepair = guardRepairProposal({
      summary: 'Use a folder.',
      operations: [{
        field: 'file_access',
        value: [{ path: '/Users/example/Documents/..', kind: 'folder', access: 'read_only' }],
      }],
      risk: 'low',
      rerun_after_apply: true,
    });
    const nativeRepair = guardRepairProposal({
      summary: 'Add Calendar access.',
      operations: [{
        field: 'native_services',
        value: { calendar: { resources: [{ id: 'work', name: 'Work', actions: ['create'] }] } },
      }],
      risk: 'low',
      rerun_after_apply: true,
    });

    expect(fileRepair.can_automate).toBe(false);
    expect(nativeRepair.can_automate).toBe(false);
    expect(nativeRepair.requires_confirmation).toBe(true);
  });

  it('builds a minimal diagnostic prompt without the full agent instructions', () => {
    const prompt = buildDiagnosticPrompt({
      agent: makeAgent({ prompt: 'Private instructions that must not be copied.' }),
      run: makeStoredRun({ status: 'failed', error: 'Unknown service response' }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
    });

    expect(prompt).not.toContain('Private instructions');
    expect(prompt).toContain('Unknown service response');
    expect(prompt).toContain('Do not invent evidence');
  });
});
