import { describe, expect, it } from 'vitest';
import {
  buildAgentProposalPrompt,
  createAgentProposal,
  type ProposalModel,
} from './proposal-service.js';
import { proposalToAgentConfig } from './proposal-configuration.js';
import { CreationProposalSchema } from './proposal-schema.js';
import { isToolPermitted } from '../execution/permission-policy.js';

function validProposal(): Record<string, unknown> {
  return {
    schema_version: 1,
    name: 'Friday GitHub summary',
    description: 'Summarizes GitHub activity and sends it to Slack.',
    instructions: 'Review GitHub activity and prepare a concise weekly summary.',
    explanation: 'Each Friday, the agent reads GitHub activity and sends a short summary.',
    trigger: {
      type: 'schedule',
      schedule: '0 17 * * 5',
      human_description: 'Every Friday at 5:00 p.m.',
    },
    timezone: 'Europe/Lisbon',
    capabilities: [],
    connections: [{
      id: 'slack',
      name: 'Slack',
      required: true,
      status: 'needs_setup',
      reason: 'The summary needs a destination.',
    }],
    file_access: [],
    permissions: {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: true,
      can_use_connected_apps: true,
      can_send_messages: true,
    },
    notification_destination: { kind: 'slack', label: 'Slack', configured: false },
    runtime: null,
    risk: { level: 'needs_review', reasons: ['It sends information to Slack.'], finding_count: 0 },
    missing_information: ['Choose a Slack destination.'],
    questions: [{
      id: 'slack-destination',
      question: 'Where in Slack should the summary be sent?',
      control: 'service',
      required: true,
    }],
    markdown_instructions: '# Weekly GitHub summary\n\nReview the activity and do not expose secrets.',
  };
}

function modelReturning(...responses: unknown[]): { model: ProposalModel; calls: () => number } {
  let callCount = 0;
  return {
    model: {
      generate: async () => responses[Math.min(callCount++, responses.length - 1)],
    },
    calls: () => callCount,
  };
}

describe('guided agent proposal creation', () => {
  it('accepts a valid least-privilege structured proposal', async () => {
    const fake = modelReturning(validProposal());

    const result = await createAgentProposal({
      request: 'Every Friday, summarize my GitHub activity in Slack.',
      timezone: 'Europe/Lisbon',
      connectedServices: ['github'],
      model: fake.model,
    });

    expect(result.status).toBe('proposal');
    if (result.status !== 'proposal') throw new Error('Expected proposal');
    expect(result.proposal.permissions.can_modify_files).toBe(false);
    expect(result.proposal.questions[0]?.question).toContain('Slack');
    expect(fake.calls()).toBe(1);
  });

  it('rejects contradictory privilege and trigger claims before use', async () => {
    const unsafe = validProposal();
    unsafe.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: true,
      can_use_connected_apps: true,
      can_send_messages: true,
    };
    unsafe.file_access = [{
      path: '~/Documents',
      access: 'read_write',
      is_suggestion: false,
      reason: 'Save reports.',
    }];
    const fake = modelReturning(unsafe, unsafe);

    const result = await createAgentProposal({
      request: 'Save reports in Documents.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      model: fake.model,
    });

    expect(result.status).toBe('needs_information');
    expect(fake.calls()).toBe(2);
  });

  it('retries malformed model output once and then returns a safe local fallback', async () => {
    const fake = modelReturning('not JSON', { name: 'Incomplete' });

    const result = await createAgentProposal({
      request: 'Read files from a folder and prepare a summary.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      model: fake.model,
    });

    expect(result).toMatchObject({
      status: 'needs_information',
      usedFallback: true,
      questions: [{ control: 'path' }],
    });
    expect(fake.calls()).toBe(2);
  });

  it('redacts secrets and tells the model to use narrow permissions', () => {
    const prompt = buildAgentProposalPrompt({
      request: 'Use api_key="sk-ant-secretvalue123456" to send a report.',
      timezone: 'Europe/Lisbon',
      connectedServices: ['slack'],
    });

    expect(prompt).not.toContain('sk-ant-secretvalue123456');
    expect(prompt).toContain('[REDACTED]');
    expect(prompt).toContain('Never add write access');
    expect(prompt).toContain('Return only a value matching the supplied JSON schema');
  });

  it('does not accept questions that are absent from missing information', async () => {
    const proposal = validProposal();
    proposal.missing_information = [];
    const fake = modelReturning(proposal, proposal);

    const result = await createAgentProposal({
      request: 'Summarize GitHub activity.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      model: fake.model,
    });

    expect(result.status).toBe('needs_information');
  });

  it('rejects a low-risk claim when powerful access is requested', async () => {
    const proposal = validProposal();
    proposal.permissions = {
      can_modify_files: false,
      can_run_commands: true,
      requires_network: true,
      can_use_connected_apps: true,
      can_send_messages: true,
    };
    proposal.risk = { level: 'low', reasons: [], finding_count: 0 };
    const fake = modelReturning(proposal, proposal);

    const result = await createAgentProposal({
      request: 'Run a command and send the result.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      model: fake.model,
    });

    expect(result.status).toBe('needs_information');
  });

  it('rejects invalid schedules, time zones, and incomplete watch triggers', async () => {
    const proposal = validProposal();
    proposal.trigger = { type: 'watch', schedule: 'not a schedule', human_description: 'When files change.' };
    proposal.timezone = 'Somewhere/Imaginary';
    const fake = modelReturning(proposal, proposal);

    const result = await createAgentProposal({
      request: 'Watch a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      model: fake.model,
    });

    expect(result.status).toBe('needs_information');
  });

  it('materializes unselected capabilities as an explicit default-deny policy', () => {
    const proposal = validProposal();
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: false,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    proposal.missing_information = [];
    proposal.questions = [];
    proposal.risk = { level: 'low', reasons: [], finding_count: 0 };
    const parsed = CreationProposalSchema.parse(proposal);

    const agent = proposalToAgentConfig(parsed, 'friday-summary');

    expect(agent.permissions).toEqual({ allow: [], deny: [] });
    expect(agent.enabled).toBe(false);
    expect(agent.codex_sandbox).toBe('read-only');
    expect(isToolPermitted(agent, 'Read')).toBe(false);
    expect(isToolPermitted(agent, 'Bash')).toBe(false);
    expect(isToolPermitted(agent, 'UnknownFutureTool')).toBe(false);
  });
});
