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

function completeProposal(): Record<string, unknown> {
  return {
    ...validProposal(),
    connections: [{
      id: 'slack', name: 'Slack', required: true, status: 'connected', reason: 'The summary needs a destination.',
    }],
    notification_destination: { kind: 'slack', label: 'Team updates', configured: true },
    missing_information: [],
    questions: [],
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
  it('chooses an existing required service before asking for file access', async () => {
    const fake = modelReturning(completeProposal());
    const request = 'Every morning, review a Word manuscript and store the results in Personal Notion.';

    const connection = await createAgentProposal({
      request,
      timezone: 'Europe/Lisbon',
      connectedServices: [
        { id: 'notion-personal', name: 'Personal Notion' },
        { id: 'claude.ai Notion Work', name: 'Work Notion' },
      ],
      answers: [],
      model: fake.model,
    });
    const file = await createAgentProposal({
      request,
      timezone: 'Europe/Lisbon',
      connectedServices: [
        { id: 'notion-personal', name: 'Personal Notion' },
        { id: 'claude.ai Notion Work', name: 'Work Notion' },
      ],
      answers: [{ question_id: 'connection-notion', value: 'notion-personal' }],
      model: fake.model,
    });
    const staleConnection = await createAgentProposal({
      request,
      timezone: 'Europe/Lisbon',
      connectedServices: [{ id: 'notion-personal', name: 'Personal Notion' }],
      answers: [{ question_id: 'connection-notion', value: 'removed-notion' }],
      model: fake.model,
    });

    expect(connection).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'connection-notion',
        control: 'service',
        service_name: 'Notion',
        choices: [
          { label: 'Personal Notion', value: 'notion-personal' },
          { label: 'Work Notion', value: 'claude.ai Notion Work' },
        ],
      }],
    });
    expect(file).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'file-location', control: 'path' }],
    });
    expect(staleConnection).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'connection-notion' }],
    });
    expect(fake.calls()).toBe(0);
  });

  it('offers setup when a required service has no configured connection', async () => {
    const result = await createAgentProposal({
      request: 'Review my manuscript and save the result in Notion.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'connection-notion',
        question: 'Set up Notion before choosing what this agent can access.',
        control: 'service',
        service_name: 'Notion',
        choices: [],
      }],
    });
  });

  it('asks for an exact folder and whether changes are allowed before using the model', async () => {
    const fake = modelReturning(completeProposal());

    const location = await createAgentProposal({
      request: 'Summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [],
      model: fake.model,
    });
    const access = await createAgentProposal({
      request: 'Summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{ question_id: 'file-location', value: '~/Documents/Research' }],
      model: fake.model,
    });

    expect(location).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'file-location', control: 'path' }],
    });
    expect(access).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'file-access', control: 'single_choice' }],
    });
    expect(fake.calls()).toBe(0);
  });

  it('asks which available calendar and whether it may change events', async () => {
    const fake = modelReturning(completeProposal());
    const base = {
      request: 'Summarize my calendar.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableCalendars: [
        { id: 'work-id', name: 'Work', account: 'iCloud', canModify: true },
        { id: 'holidays-id', name: 'Holidays', account: 'Subscribed', canModify: false },
      ],
      model: fake.model,
    };

    const calendar = await createAgentProposal({ ...base, answers: [] });
    const access = await createAgentProposal({
      ...base,
      answers: [{ question_id: 'calendar-id', value: 'work-id' }],
    });

    expect(calendar).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'calendar-id',
        control: 'single_choice',
        choices: [
          { label: 'Work (iCloud)', value: 'work-id' },
          { label: 'Holidays (Subscribed)', value: 'holidays-id' },
        ],
      }],
    });
    expect(access).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'calendar-access', control: 'single_choice' }],
    });
    const readOnlyAccess = await createAgentProposal({
      ...base,
      answers: [{ question_id: 'calendar-id', value: 'holidays-id' }],
    });
    expect(readOnlyAccess).toMatchObject({
      status: 'needs_information',
      questions: [{ choices: [{ label: 'View only', value: 'read_only' }] }],
    });
    expect(fake.calls()).toBe(0);
  });
  it('returns required model questions before issuing a proposal', async () => {
    const fake = modelReturning(validProposal());

    const result = await createAgentProposal({
      request: 'Every Friday, summarize my GitHub activity in Slack.',
      timezone: 'Europe/Lisbon',
      connectedServices: ['github'],
      model: fake.model,
    });

    expect(result.status).toBe('needs_information');
    if (result.status !== 'needs_information') throw new Error('Expected questions');
    expect(result.questions[0]?.question).toContain('Slack');
    expect(result.usedFallback).toBe(false);
    expect(fake.calls()).toBe(1);
  });

  it('accepts a complete least-privilege structured proposal', async () => {
    const result = await createAgentProposal({
      request: 'Every Friday, summarize my GitHub activity in Slack.',
      timezone: 'Europe/Lisbon',
      connectedServices: ['github', 'slack'],
      model: modelReturning(completeProposal()).model,
    });

    expect(result.status).toBe('proposal');
    if (result.status !== 'proposal') throw new Error('Expected proposal');
    expect(result.proposal.permissions.can_modify_files).toBe(false);
    expect(result.proposal.questions).toEqual([]);
  });

  it('limits a view-only calendar proposal to reading the selected calendar', () => {
    const proposal = completeProposal();
    proposal.capabilities = [{
      id: 'calendar', name: 'Calendar', required: true, status: 'connected', reason: 'Reads upcoming events.',
    }];
    proposal.calendar_access = [{
      id: 'work-id', name: 'Work', access: 'read_only', reason: 'Reads work events.',
    }];
    proposal.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: false,
      can_use_connected_apps: true,
      can_send_messages: false,
    };
    proposal.notification_destination = null;

    const parsed = CreationProposalSchema.parse(proposal);
    const config = proposalToAgentConfig(parsed, 'calendar-summary');

    expect(config.calendar_access).toEqual([{ id: 'work-id', name: 'Work', access: 'read_only' }]);
    expect(config.permissions?.allow).toContain('mcp__eventkit__list_events');
    expect(config.permissions?.allow).not.toContain('mcp__eventkit__create_event');
    expect(config.permissions?.allow).not.toContain('mcp__eventkit__delete_event');
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
      answers: [
        { question_id: 'file-location', value: '~/Documents' },
        { question_id: 'file-access', value: 'read_write' },
      ],
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
      answers: [
        { question_id: 'file-location', value: '~/Documents/Research' },
        { question_id: 'file-access', value: 'read_only' },
      ],
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
      connectedServices: [{ id: 'claude.ai Slack', name: 'Slack' }],
    });

    expect(prompt).not.toContain('sk-ant-secretvalue123456');
    expect(prompt).toContain('[REDACTED]');
    expect(prompt).toContain('Never add write access');
    expect(prompt).toContain('Return only a value matching the supplied JSON schema');
  });

  it('includes only the selected calendar in the model prompt', () => {
    const prompt = buildAgentProposalPrompt({
      request: 'Summarize my calendar.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{ question_id: 'calendar-id', value: 'work-id' }],
      availableCalendars: [
        { id: 'work-id', name: 'Work', account: 'iCloud', canModify: true },
        { id: 'personal-id', name: 'Personal', account: 'iCloud', canModify: true },
      ],
    });

    expect(prompt).toContain('Work (work-id)');
    expect(prompt).not.toContain('Personal');
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

  it('materializes reviewed folders, watch triggers, notifications, and service access', () => {
    const proposal = completeProposal();
    proposal.trigger = {
      type: 'watch',
      watched_path: '~/Documents/Research',
      human_description: 'When a Markdown file changes in Research.',
    };
    proposal.file_access = [{
      path: '~/Documents/Research', access: 'read_only', is_suggestion: false, reason: 'Read research notes.',
    }];
    const agent = proposalToAgentConfig(CreationProposalSchema.parse(proposal), 'research-watcher');

    expect(agent.working_directory).toBe('~/Documents/Research');
    expect(agent.watch).toEqual([{ path: '~/Documents/Research' }]);
    expect(agent.notification).toEqual({ channel: 'slack', on_complete: true, on_failure: true });
    expect(agent.permissions?.allow).toContain('mcp__slack__*');
    expect(agent.permissions?.allow).toContain('Read');
  });
});
