import { describe, expect, it } from 'vitest';
import {
  buildAgentProposalPrompt,
  createAgentProposal as createAgentProposalService,
  servicesRelevantToRequest,
  type ProposalModel,
} from './proposal-service.js';
import { proposalToAgentConfig } from './proposal-configuration.js';
import { CreationProposalSchema, ProposalRequestSchema } from './proposal-schema.js';
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

function createAgentProposal(input: Parameters<typeof createAgentProposalService>[0]) {
  const answers = input.answers ?? [];
  return createAgentProposalService({
    ...input,
    answers: answers.some((answer) => answer.question_id === 'runtime')
      ? answers
      : [...answers, { question_id: 'runtime', value: '' }],
  });
}

describe('guided agent proposal creation', () => {
  it('returns every mentioned connection together without inventing file access', async () => {
    const result = await createAgentProposal({
      request: 'Save a note in Notion, then create a Linear issue.',
      timezone: 'Europe/Lisbon',
      connectedServices: [
        {
          id: 'notion-personal', service_id: 'notion', name: 'Personal Notion', source: 'configured_api',
          actions: ['read', 'write'], actions_known: true,
        },
        {
          id: 'linear-work', service_id: 'linear', name: 'Work Linear', source: 'account',
          actions: ['read', 'write'], actions_known: true,
        },
      ],
      answers: [],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).toMatchObject({
      status: 'needs_information',
      questions: [
        { id: 'connection-notion', service_name: 'Notion', choices: [{ value: 'notion-personal', source: 'configured_api' }] },
        { id: 'connection-linear', service_name: 'Linear', choices: [{ value: 'linear-work', source: 'account' }] },
      ],
    });
    if (result.status === 'needs_information') {
      expect(result.questions.some((question) => question.id === 'file-access')).toBe(false);
    }
  });

  it('uses the shared capability catalog for supported connection questions', async () => {
    const result = await createAgentProposal({
      request: 'Add the itinerary to TripMaster.',
      timezone: 'Europe/Lisbon',
      connectedServices: [{
        id: 'tripmaster-personal', service_id: 'tripmaster', name: 'Personal TripMaster',
        source: 'configured_api', actions: ['read', 'write'], actions_known: true,
      }],
      answers: [],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'connection-tripmaster',
        service_name: 'TripMaster',
        choices: [{ value: 'tripmaster-personal' }],
      }],
    });
  });

  it('does not require file access for a scheduled Slack heartbeat', async () => {
    const service = {
      id: 'slack-personal', service_id: 'slack', name: 'Personal Slack', source: 'account' as const,
      actions: ['read', 'send'] as const, actions_known: true,
    };
    const initial = await createAgentProposal({
      request: 'Every morning, send me a witty saying in Slack.',
      timezone: 'Europe/Lisbon',
      connectedServices: [service],
      answers: [],
      model: modelReturning(completeProposal()).model,
    });

    expect(initial).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'connection-slack', choices: [{ value: 'slack-personal' }] }],
    });
    if (initial.status === 'needs_information') {
      expect(initial.questions.some((question) => question.id === 'file-access')).toBe(false);
    }
  });

  it('keeps deferred connections visible without asking the same setup question again', async () => {
    const result = await createAgentProposal({
      request: 'Every morning, save a short note in Notion.',
      timezone: 'Europe/Lisbon',
      connectedServices: [{
        id: 'notion-personal', service_id: 'notion', name: 'Personal Notion',
        source: 'configured_api', actions: ['read', 'write'], actions_known: true,
      }],
      answers: [{ question_id: 'connection-notion', value: '__set_up_later__' }],
    });

    expect(result).toMatchObject({
      status: 'proposal',
      proposal: {
        connections: [{ id: 'notion', name: 'Notion', required: true, status: 'needs_setup' }],
      },
    });
  });

  it('asks for file scope and runtime before runtime-scoped service choices', async () => {
    const fake = modelReturning(completeProposal());
    const request = 'Every morning, review a Word manuscript and store the results in Personal Notion.';

    const file = await createAgentProposalService({
      request,
      timezone: 'Europe/Lisbon',
      connectedServices: [
        { id: 'notion-personal', service_id: 'notion', name: 'Personal Notion', source: 'configured_api' },
        { id: 'claude.ai Notion', service_id: 'notion', name: 'Notion', source: 'account' },
      ],
      answers: [],
      model: fake.model,
    });
    const runtime = await createAgentProposalService({
      request,
      timezone: 'Europe/Lisbon',
      connectedServices: [
        { id: 'notion-personal', service_id: 'notion', name: 'Personal Notion', source: 'configured_api' },
        { id: 'claude.ai Notion', service_id: 'notion', name: 'Notion', source: 'account' },
      ],
      answers: [{
        question_id: 'file-access',
        value: [{ path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' }],
      }],
      model: fake.model,
    });
    const connection = await createAgentProposalService({
      request,
      timezone: 'Europe/Lisbon',
      connectedServices: [
        { id: 'notion-personal', service_id: 'notion', name: 'Personal Notion', source: 'configured_api' },
        { id: 'claude.ai Notion', service_id: 'notion', name: 'Notion', source: 'account' },
      ],
      answers: [
        {
          question_id: 'file-access',
          value: [{ path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' }],
        },
        { question_id: 'runtime', value: 'claude-code' },
      ],
      model: fake.model,
    });

    expect(file).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'file-access', control: 'file_access' }],
    });
    expect(runtime).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'runtime', control: 'runtime' }],
    });
    expect(connection).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'connection-notion',
        control: 'service',
        service_name: 'Notion',
        choices: [
          { label: 'Personal Notion', value: 'notion-personal', source: 'configured_api' },
          { label: 'Notion', value: 'claude.ai Notion', source: 'account' },
        ],
      }],
    });
    expect(fake.calls()).toBe(0);
  });

  it('does not silently substitute a work account for requested Personal Notion', async () => {
    const result = await createAgentProposal({
      request: 'Review my manuscript and save the result in Personal Notion.',
      timezone: 'Europe/Lisbon',
      connectedServices: [{ id: 'notion-work', name: 'Work Notion' }],
      answers: [],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'connection-notion', choices: [{ value: 'notion-work' }] }],
    });
  });

  it('does not mistake a connection name substring for a requested account', async () => {
    const result = await createAgentProposal({
      request: 'Save the review in Work Notion.',
      timezone: 'Europe/Lisbon',
      connectedServices: [{ id: 'notion-network', name: 'Notion Network' }],
      answers: [],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'connection-notion' }],
    });
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

  it('asks for one or more exact file grants before using the model', async () => {
    const reviewed = completeProposal();
    reviewed.connections = [];
    reviewed.notification_destination = null;
    reviewed.permissions.can_use_connected_apps = false;
    reviewed.permissions.can_send_messages = false;
    reviewed.file_access = [{
      path: '~/Documents/Research', kind: 'folder', access: 'read_only',
      is_suggestion: false, reason: 'Reads the selected research folder.',
    }];
    const fake = modelReturning(reviewed);

    const location = await createAgentProposal({
      request: 'Summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [],
      model: fake.model,
    });
    const ready = await createAgentProposal({
      request: 'Summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{
        question_id: 'file-access',
        value: [{ path: '~/Documents/Research', kind: 'folder', access: 'read_only' }],
      }],
      model: fake.model,
    });

    expect(location).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'file-access', control: 'file_access' }],
    });
    expect(ready.status).toBe('proposal');
    expect(fake.calls()).toBe(1);
  });

  it('asks for the runtime after file access and before calendar access', async () => {
    const base = {
      request: 'Review a file and compare it with my calendar.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableCalendars: [
        { id: 'work-id', name: 'Work', account: 'iCloud', canModify: true },
      ],
      model: modelReturning(completeProposal()).model,
    };

    const fileAccess = await createAgentProposalService({ ...base, answers: [] });
    const runtime = await createAgentProposalService({
      ...base,
      answers: [{ question_id: 'file-access', value: [] }],
    });
    const calendar = await createAgentProposalService({
      ...base,
      answers: [
        { question_id: 'file-access', value: [] },
        { question_id: 'runtime', value: '' },
      ],
    });

    expect(fileAccess).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'file-access', control: 'file_access' }],
    });
    expect(runtime).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'runtime',
        control: 'runtime',
        choices: [
          { label: 'Codex', value: 'codex' },
          { label: 'Claude Code', value: 'claude-code' },
          { label: 'Kimi Code', value: 'kimi-code' },
        ],
      }],
    });
    expect(calendar).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'calendar-id', control: 'single_choice' }],
    });
  });

  it('applies an explicit runtime choice after file access is confirmed', async () => {
    const reviewed = completeProposal();
    reviewed.connections = [];
    reviewed.notification_destination = null;
    reviewed.permissions.can_use_connected_apps = false;
    reviewed.permissions.can_send_messages = false;
    reviewed.file_access = [{
      path: '~/Documents/Research', kind: 'folder', access: 'read_only',
      is_suggestion: false, reason: 'Reads the selected research folder.',
    }];
    reviewed.runtime = {
      executor: 'claude-code', model: null, reason: 'The model chose the default runtime.',
    };

    const result = await createAgentProposal({
      request: 'Summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [
        {
          question_id: 'file-access',
          value: [{ path: '~/Documents/Research', kind: 'folder', access: 'read_only' }],
        },
        { question_id: 'runtime', value: 'kimi-code' },
      ],
      model: modelReturning(reviewed).model,
    });

    expect(result).toMatchObject({
      status: 'proposal',
      proposal: {
        runtime: {
          executor: 'kimi-code',
          model: null,
          reason: 'Uses the coding agent selected during setup.',
        },
      },
    });
  });

  it('keeps Codex selected in a fallback proposal with reviewed file access', async () => {
    const result = await createAgentProposalService({
      request: 'Summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [
        {
          question_id: 'file-access',
          value: [{ path: '~/Documents/Research', kind: 'folder', access: 'read_only' }],
        },
        { question_id: 'runtime', value: 'codex' },
      ],
    });

    expect(result).toMatchObject({
      status: 'proposal',
      usedFallback: true,
      proposal: { runtime: { executor: 'codex', model: null } },
    });
  });

  it('marks runtimes that cannot enforce the reviewed access as unavailable', async () => {
    const fileGrant = {
      question_id: 'file-access',
      value: [{ path: '~/Documents/Research', kind: 'folder' as const, access: 'read_only' as const }],
    };
    const fileOnly = await createAgentProposalService({
      request: 'Summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [fileGrant],
    });
    const withCommands = await createAgentProposalService({
      request: 'Run a Bash command to summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [fileGrant],
    });

    expect(fileOnly).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'runtime',
        choices: [
          { value: 'codex' },
          { value: 'claude-code' },
          { value: 'kimi-code' },
        ],
      }],
    });
    expect(withCommands).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'runtime',
        choices: [
          { value: 'codex' },
          { value: 'claude-code' },
          { value: 'kimi-code', disabled_reason: "Can't enforce file access." },
        ],
      }],
    });
  });

  it('rejects a crafted answer that selects a disabled runtime', async () => {
    const result = await createAgentProposalService({
      request: 'Run a Bash command to summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [
        {
          question_id: 'file-access',
          value: [{ path: '~/Documents/Research', kind: 'folder', access: 'read_only' }],
        },
        { question_id: 'runtime', value: 'kimi-code' },
      ],
    });

    expect(result).toMatchObject({
      status: 'needs_information',
      questions: [{
        id: 'runtime',
        choices: [{ value: 'codex' }, { value: 'claude-code' }, {
          value: 'kimi-code', disabled_reason: "Can't enforce file access.",
        }],
      }],
    });
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

  it('asks which Reminder list and which exact changes it may make', async () => {
    const proposal = completeProposal();
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.permissions.can_use_connected_apps = true;
    proposal.permissions.can_send_messages = false;
    const fake = modelReturning(proposal);
    const base = {
      request: 'Review my reminders every morning.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableReminderLists: [
        { id: 'personal-id', name: 'Personal', account: 'iCloud', canModify: true },
        { id: 'shared-id', name: 'Shared', account: 'iCloud', canModify: false },
      ],
      model: fake.model,
    };

    const list = await createAgentProposal({ ...base, answers: [] });
    const actions = await createAgentProposal({
      ...base, answers: [{ question_id: 'reminder-list-id', value: 'personal-id' }],
    });
    const ready = await createAgentProposal({
      ...base,
      answers: [
        { question_id: 'reminder-list-id', value: 'personal-id' },
        { question_id: 'reminder-actions', value: 'read_create_complete' },
      ],
    });

    expect(list).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'reminder-list-id', choices: [{ value: 'personal-id' }, { value: 'shared-id' }] }],
    });
    expect(actions).toMatchObject({
      status: 'needs_information', questions: [{ id: 'reminder-actions' }],
    });
    expect(ready).toMatchObject({
      status: 'proposal',
      proposal: { native_services: { reminders: { resources: [{
        id: 'personal-id', name: 'Personal', actions: ['read', 'create', 'complete'],
      }] } } },
    });
  });

  it('does not treat generic software events as Calendar access', async () => {
    const result = await createAgentProposal({
      request: 'Summarize GitHub webhook events.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableCalendars: [{ id: 'work', name: 'Work', account: 'iCloud', canModify: true }],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).not.toMatchObject({
      status: 'needs_information', questions: [{ id: 'calendar-id' }],
    });
  });

  it('does not treat generic project tasks as Apple Reminders', async () => {
    const result = await createAgentProposal({
      request: 'Summarize my Notion project tasks.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableReminderLists: [{ id: 'personal', name: 'Personal', account: 'iCloud', canModify: true }],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).not.toMatchObject({
      status: 'needs_information', questions: [{ id: 'reminder-list-id' }],
    });
  });

  it('recognizes scheduling a meeting as Calendar access', async () => {
    const result = await createAgentProposal({
      request: 'Schedule a meeting with the design team.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableCalendars: [{ id: 'work', name: 'Work', account: 'iCloud', canModify: true }],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).toMatchObject({
      status: 'needs_information', questions: [{ id: 'calendar-id' }],
    });
  });

  it('asks which Contacts group and which details it may read', async () => {
    const proposal = completeProposal();
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.permissions.can_use_connected_apps = true;
    proposal.permissions.can_send_messages = false;
    proposal.permissions.requires_network = false;
    const fake = modelReturning(proposal);
    const base = {
      request: 'Create a birthday summary from my contacts.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableContactGroups: [
        { id: 'family-id', name: 'Family', account: 'iCloud' },
        { id: 'work-id', name: 'Coworkers', account: 'Google' },
      ],
      model: fake.model,
    };

    const group = await createAgentProposal({ ...base, answers: [] });
    const fields = await createAgentProposal({
      ...base, answers: [{ question_id: 'contact-group-id', value: 'family-id' }],
    });
    const ready = await createAgentProposal({
      ...base,
      answers: [
        { question_id: 'contact-group-id', value: 'family-id' },
        { question_id: 'contact-fields', value: 'name_email' },
      ],
    });

    expect(group).toMatchObject({ status: 'needs_information', questions: [{ id: 'contact-group-id' }] });
    expect(fields).toMatchObject({ status: 'needs_information', questions: [{ id: 'contact-fields' }] });
    expect(ready).toMatchObject({
      status: 'proposal', proposal: { native_services: { contacts: { resources: [{
        id: 'family-id', name: 'Family', account: 'iCloud', actions: ['read'], fields: ['name', 'email'],
      }] } } },
    });
    if (ready.status !== 'proposal') throw new Error('Expected proposal');
    const config = proposalToAgentConfig(ready.proposal, 'birthday-summary');
    expect(config.permissions?.allow).toContain('mcp__eventkit__list_contacts');
    expect(config.permissions?.allow).not.toContain('mcp__eventkit__create_contact');
  });

  it('does not treat the verb contact as macOS Contacts access', async () => {
    const result = await createAgentProposal({
      request: 'Contact my editor in Slack when the report is ready.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableContactGroups: [{ id: 'family', name: 'Family', account: 'iCloud' }],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).not.toMatchObject({
      status: 'needs_information', questions: [{ id: 'contact-group-id' }],
    });
  });

  it('recognizes plain contacts used as a data source', async () => {
    const result = await createAgentProposal({
      request: 'Search contacts for email addresses.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableContactGroups: [{ id: 'family', name: 'Family', account: 'iCloud' }],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).toMatchObject({
      status: 'needs_information', questions: [{ id: 'contact-group-id' }],
    });
  });

  it('explains that Apple Music cannot be granted instead of generating a false proposal', async () => {
    const result = await createAgentProposal({
      request: 'Review my Apple Music library every Friday.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      model: modelReturning(completeProposal()).model,
    });

    expect(result).toMatchObject({
      status: 'needs_information',
      questions: [{ id: 'apple-music-unavailable', control: 'unavailable', required: true }],
    });
  });

  it('does not assume a generic music library means Apple Music', async () => {
    const result = await createAgentProposal({
      request: 'Catalog tracks in my music library.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      model: modelReturning(completeProposal()).model,
    });

    expect(result.status === 'needs_information'
      ? result.questions.map((question) => question.id)
      : []).not.toContain('apple-music-unavailable');
  });

  it('re-asks when a Reminder answer is no longer available or allowed', async () => {
    const fake = modelReturning(completeProposal());
    const base = {
      request: 'Review my reminders every morning.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableReminderLists: [
        { id: 'personal-id', name: 'Personal', account: 'iCloud', canModify: false },
      ],
      model: fake.model,
    };

    const missingList = await createAgentProposal({
      ...base,
      answers: [{ question_id: 'reminder-list-id', value: 'removed-id' }],
    });
    const forbiddenAction = await createAgentProposal({
      ...base,
      answers: [
        { question_id: 'reminder-list-id', value: 'personal-id' },
        { question_id: 'reminder-actions', value: 'read_create' },
      ],
    });

    expect(missingList).toMatchObject({
      status: 'needs_information', questions: [{ id: 'reminder-list-id' }],
    });
    expect(forbiddenAction).toMatchObject({
      status: 'needs_information', questions: [{ id: 'reminder-actions' }],
    });
    expect(fake.calls()).toBe(0);
  });
  it('returns deterministic connection questions before calling the model', async () => {
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
    expect(result.usedFallback).toBe(true);
    expect(fake.calls()).toBe(0);
  });

  it('accepts a complete least-privilege structured proposal', async () => {
    const result = await createAgentProposal({
      request: 'Every Friday, summarize my GitHub activity in Slack.',
      timezone: 'Europe/Lisbon',
      connectedServices: ['github', 'slack'],
      answers: [{ question_id: 'connection-slack', value: 'slack' }],
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
      id: 'work-id', name: 'Work', account: 'Personal', access: 'read_only', reason: 'Reads work events.',
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

    expect(config.calendar_access).toEqual([{
      id: 'work-id', name: 'Work', account: 'Personal', access: 'read_only',
    }]);
    expect(config.permissions?.allow).toContain('mcp__eventkit__list_events');
    expect(config.permissions?.allow).not.toContain('mcp__eventkit__create_event');
    expect(config.permissions?.allow).not.toContain('mcp__eventkit__delete_event');
  });

  it('replaces model-owned Calendar access with the reviewed selection', async () => {
    const proposal = completeProposal();
    proposal.calendar_access = [{
      id: 'invented-id', name: 'Every calendar', access: 'read_write', reason: 'Model suggestion.',
    }];
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.permissions.can_use_connected_apps = true;
    proposal.permissions.can_send_messages = false;
    proposal.permissions.requires_network = false;
    proposal.risk.level = 'high';

    const result = await createAgentProposal({
      request: 'Review my calendar every morning.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      availableCalendars: [{ id: 'work-id', name: 'Work', account: 'iCloud', canModify: true }],
      answers: [
        { question_id: 'calendar-id', value: 'work-id' },
        { question_id: 'calendar-access', value: 'read_only' },
      ],
      model: modelReturning(proposal).model,
    });

    expect(result).toMatchObject({
      status: 'proposal',
      proposal: {
        calendar_access: [{ id: 'work-id', name: 'Work', access: 'read_only' }],
      },
    });
  });

  it('replaces contradictory model file permissions with the reviewed grant', async () => {
    const unsafe = completeProposal();
    unsafe.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: false,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    unsafe.connections = [];
    unsafe.notification_destination = null;
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
        { question_id: 'file-access', value: [{ path: '~/Documents', kind: 'folder', access: 'read_write' }] },
      ],
      model: fake.model,
    });

    expect(result).toMatchObject({
      status: 'proposal',
      proposal: { permissions: { can_modify_files: true } },
    });
    expect(fake.calls()).toBe(1);
  });

  it('rejects command execution combined with exact file scopes', () => {
    const proposal = completeProposal();
    proposal.file_access = [{
      path: '~/Books', kind: 'folder', access: 'read_only', is_suggestion: false, reason: 'Reads the manuscript.',
    }];
    proposal.permissions.can_run_commands = true;
    proposal.risk = { level: 'high', reasons: ['Runs commands.'], finding_count: 0 };

    expect(() => CreationProposalSchema.parse(proposal)).toThrow(/commands.*file/i);
  });

  it('retries malformed model output once and then builds a safe proposal from confirmed answers', async () => {
    const fake = modelReturning('not JSON', { name: 'Incomplete' });

    const result = await createAgentProposal({
      request: 'Read files from a folder and prepare a summary.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [
        {
          question_id: 'file-access',
          value: [{ path: '~/Documents/Research', kind: 'folder', access: 'read_only' }],
        },
      ],
      model: fake.model,
    });

    expect(result).toMatchObject({
      status: 'proposal',
      usedFallback: true,
      proposal: {
        file_access: [{
          path: '~/Documents/Research',
          kind: 'folder',
          access: 'read_only',
          is_suggestion: false,
        }],
        permissions: {
          can_modify_files: false,
          can_run_commands: false,
          requires_network: false,
          can_use_connected_apps: false,
          can_send_messages: false,
        },
        missing_information: [],
        questions: [],
      },
    });
    expect(fake.calls()).toBe(2);
  });

  it('preserves the exact selected service and a simple daily schedule in the local proposal', async () => {
    const result = await createAgentProposal({
      request: 'Every morning at 3am, review my manuscript and store the result in Personal Notion.',
      timezone: 'Europe/Lisbon',
      connectedServices: [
        { id: 'notion-personal', service_id: 'notion', name: 'Personal Notion' },
        { id: 'notion-work', service_id: 'notion', name: 'Work Notion' },
      ],
      answers: [
        { question_id: 'connection-notion', value: 'notion-personal' },
        {
          question_id: 'file-access',
          value: [{ path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' }],
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'proposal',
      usedFallback: true,
      proposal: {
        trigger: {
          type: 'schedule',
          schedule: '0 3 * * *',
          human_description: 'Every day at 3:00 AM',
        },
        connections: [{ id: 'notion-personal', name: 'Personal Notion', required: true }],
        file_access: [{ path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' }],
        permissions: {
          can_run_commands: false,
          requires_network: true,
          can_use_connected_apps: true,
        },
        missing_information: [],
        questions: [],
      },
    });
    if (result.status !== 'proposal') throw new Error('Expected proposal');
    expect(result.proposal.connections).toHaveLength(1);
  });

  it('excludes Notion when it was neither mentioned nor selected', async () => {
    const result = await createAgentProposal({
      request: 'Every day at 7am, summarize the selected research folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [
        { id: 'notion-personal', service_id: 'notion', name: 'Personal Notion' },
        { id: 'github-work', service_id: 'github', name: 'Work GitHub' },
      ],
      answers: [{
        question_id: 'file-access',
        value: [{ path: '~/Research', kind: 'folder', access: 'read_only' }],
      }],
    });

    expect(result).toMatchObject({ status: 'proposal', usedFallback: true });
    if (result.status !== 'proposal') throw new Error('Expected proposal');
    expect(result.proposal.connections).toEqual([]);
    expect(result.proposal.permissions.can_use_connected_apps).toBe(false);
    expect(result.proposal.permissions.requires_network).toBe(false);
  });

  it('keeps a valid model proposal after removing a question the user already answered', async () => {
    const stale = validProposal();
    stale.connections = [];
    stale.notification_destination = null;
    stale.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: false,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    stale.missing_information = ['Choose the folder.'];
    stale.questions = [{
      id: 'file-access',
      question: 'Which folder should this agent use?',
      control: 'path',
      required: true,
    }];

    const result = await createAgentProposal({
      request: 'Summarize files in a folder.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{
        question_id: 'file-access',
        value: [{ path: '~/Research', kind: 'folder', access: 'read_only' }],
      }],
      model: modelReturning(stale, stale).model,
    });

    expect(result).toMatchObject({ status: 'proposal', usedFallback: false });
    if (result.status !== 'proposal') throw new Error('Expected proposal');
    expect(result.proposal.questions).toEqual([]);
    expect(result.proposal.missing_information).toEqual([]);
  });

  it('keeps answered connection and file choices when the model repeats both questions', async () => {
    const stale = completeProposal();
    stale.connections = [];
    stale.notification_destination = null;
    stale.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: true,
      can_use_connected_apps: true,
      can_send_messages: false,
    };
    stale.missing_information = ['Choose the Notion connection and manuscript folder.'];
    stale.questions = [
      {
        id: 'connection-notion',
        question: 'Which Notion connection should this agent use?',
        control: 'service',
        required: true,
      },
      {
        id: 'file-access',
        question: 'Which manuscript folder should this agent use?',
        control: 'path',
        required: true,
      },
    ];

    const result = await createAgentProposal({
      request: 'Review a manuscript folder and save the result in Notion.',
      timezone: 'Europe/Lisbon',
      connectedServices: [{
        id: 'notion-personal',
        service_id: 'notion',
        name: 'Personal Notion',
        source: 'configured_api',
        actions: ['read', 'write'],
        actions_known: true,
      }],
      answers: [
        { question_id: 'connection-notion', value: 'notion-personal' },
        {
          question_id: 'file-access',
          value: [{ path: '~/Books', kind: 'folder', access: 'read_only' }],
        },
      ],
      model: modelReturning(stale, stale).model,
    });

    expect(result).toMatchObject({ status: 'proposal', usedFallback: false });
    if (result.status !== 'proposal') throw new Error('Expected proposal');
    expect(result.proposal.connections).toEqual([expect.objectContaining({
      id: 'notion-personal',
      name: 'Personal Notion',
      status: 'connected',
      required: true,
    })]);
    expect(result.proposal.file_access).toEqual([expect.objectContaining({
      path: '~/Books',
      access: 'read_only',
      is_suggestion: false,
    })]);
    expect(result.proposal.questions).toEqual([]);
    expect(result.proposal.missing_information).toEqual([]);
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

  it('preserves the selected service identity and its allowed actions for proposal generation', () => {
    const prompt = buildAgentProposalPrompt({
      request: 'Store the result in my personal Notion.',
      timezone: 'Europe/Lisbon',
      connectedServices: [{
        id: 'mcp:notion-personal:abc123',
        service_id: 'notion',
        name: 'Personal Notion',
        source: 'configured_api',
        actions: ['read', 'write'],
        actions_known: true,
      }],
    });

    expect(prompt).toContain('Personal Notion (mcp:notion-personal:abc123)');
    expect(prompt).toContain('Known capabilities: read, write');
    expect(prompt).toContain('Connection type: configured_api');
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

  it('accepts a file-editing proposal rated needs review', () => {
    const proposal = validProposal();
    proposal.permissions = {
      can_modify_files: true,
      can_run_commands: false,
      requires_network: false,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.file_access = [{
      path: '~/Documents/Reports', access: 'read_write', is_suggestion: false, reason: 'Saves the report.',
    }];
    proposal.risk = { level: 'needs_review', reasons: ['It can change files.'], finding_count: 1 };

    expect(CreationProposalSchema.safeParse(proposal).success).toBe(true);
  });

  it('still rejects a file-editing proposal rated low', () => {
    const proposal = validProposal();
    proposal.permissions = {
      can_modify_files: true,
      can_run_commands: false,
      requires_network: false,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.file_access = [{
      path: '~/Documents/Reports', access: 'read_write', is_suggestion: false, reason: 'Saves the report.',
    }];
    proposal.risk = { level: 'low', reasons: [], finding_count: 0 };

    expect(CreationProposalSchema.safeParse(proposal).success).toBe(false);
  });

  it('still requires a high rating for command execution', () => {
    const proposal = validProposal();
    proposal.permissions = {
      can_modify_files: false,
      can_run_commands: true,
      requires_network: false,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.risk = { level: 'needs_review', reasons: ['It can run commands.'], finding_count: 1 };

    expect(CreationProposalSchema.safeParse(proposal).success).toBe(false);
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
    expect(agent.executor).toBeUndefined();
    expect(agent.model).toBeUndefined();
    expect(agent.codex_sandbox).toBeUndefined();
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
    expect(agent.connections).toMatchObject({
      slack: {
        type: 'slack',
        name: 'Slack',
        purpose: 'The summary needs a destination.',
      },
    });
    expect(agent.permissions?.allow.some((tool) => tool.startsWith('mcp__'))).toBe(false);
    expect(agent.permissions?.allow).toContain('Read');
  });

  it('materializes the exact reviewed service binding instead of its public identifier', () => {
    const proposal = completeProposal();
    proposal.connections = [{
      id: 'mcp:notion-personal:abc123',
      name: 'Personal Notion',
      required: true,
      status: 'connected',
      reason: 'Stores the review in Personal Notion.',
    }];
    proposal.notification_destination = null;
    proposal.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: true,
      can_use_connected_apps: true,
      can_send_messages: false,
    };
    const binding = {
      id: 'mcp:notion-personal:abc123',
      serverName: 'notion-personal',
      serviceType: 'notion',
      actions: ['read', 'write'],
      config: {
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: { NOTION_TOKEN: '${NOTION_PERSONAL_API_KEY}' },
      },
    } as const;

    const agent = proposalToAgentConfig(
      CreationProposalSchema.parse(proposal),
      'manuscript-review',
      { serviceBindings: [binding] },
    );

    expect(agent.connections).toEqual({
      personal_notion: {
        type: 'notion',
        name: 'Personal Notion',
        purpose: 'Stores the review in Personal Notion.',
        operations: [
          'notion.search',
          'notion.data_source.query',
          'notion.page.read',
          'notion.page.create',
        ],
        resources: {
          output_destination: {
            type: 'notion.data_source',
            purpose: 'Approved destination used by Personal Notion.',
            access: 'write',
          },
        },
      },
    });
    expect(agent.mcp_servers).toBeUndefined();
    expect(agent.connection_bindings).toBeUndefined();
    expect(agent.permissions?.allow.some((tool) => tool.startsWith('mcp__'))).toBe(false);
  });

  it('keeps local connection IDs out of the created shareable definition', () => {
    const proposal = completeProposal();
    const connectionId = '11111111-1111-4111-8111-111111111111';
    proposal.connections = [{
      id: connectionId,
      name: 'Personal Notion',
      required: true,
      status: 'connected',
      reason: 'Stores the review.',
    }];
    proposal.permissions.can_use_connected_apps = true;
    const config = { command: 'notion-helper' } as const;

    const agent = proposalToAgentConfig(
      CreationProposalSchema.parse(proposal),
      'manuscript-review',
      { serviceBindings: [{
        id: connectionId,
        connectionId,
        serverName: 'notion-personal',
        serviceType: 'notion',
        actions: ['read', 'write'],
        config,
      }] },
    );

    expect(agent.connections?.personal_notion).toMatchObject({
      type: 'notion',
      name: 'Personal Notion',
      purpose: 'Stores the review.',
    });
    expect(agent.connection_bindings).toBeUndefined();
    expect(agent.mcp_servers).toBeUndefined();
    expect(JSON.stringify(agent)).not.toContain(connectionId);
  });

  it('fails closed when reviewed services are missing and permits separate logical uses', () => {
    const proposal = completeProposal();
    proposal.connections = [
      { id: 'personal', name: 'Personal Notion', required: true, status: 'connected', reason: 'Reads notes.' },
      { id: 'work', name: 'Work Notion', required: true, status: 'connected', reason: 'Reads work notes.' },
    ];
    const reviewed = CreationProposalSchema.parse(proposal);

    expect(() => proposalToAgentConfig(reviewed, 'notes', { serviceBindings: [] }))
      .toThrow(/reviewed service binding/i);
    const agent = proposalToAgentConfig(reviewed, 'notes', {
      serviceBindings: [
        { id: 'personal', serverName: 'notion', serviceType: 'notion', actions: ['read'], config: { command: 'personal-notion' } },
        { id: 'work', serverName: 'notion', serviceType: 'notion', actions: ['read'], config: { command: 'work-notion' } },
      ],
    });
    expect(Object.keys(agent.connections ?? {})).toEqual(['personal_notion', 'work_notion']);
  });

  it('accepts multiple confirmed file grants as one structured answer', () => {
    const request = ProposalRequestSchema.parse({
      request: 'Review my manuscript against my series bible.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{
        question_id: 'file-access',
        value: [
          { path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' },
          { path: '~/Books/Series Bible', kind: 'folder', access: 'read_only' },
        ],
      }],
    });

    expect(request.answers[0]?.value).toEqual([
      { path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' },
      { path: '~/Books/Series Bible', kind: 'folder', access: 'read_only' },
    ]);
  });

  it('keeps confirmed file grants server-owned when model output tries to broaden them', async () => {
    const broadened = completeProposal();
    broadened.connections = [];
    broadened.notification_destination = null;
    broadened.file_access = [{
      path: '~/', kind: 'folder', access: 'read_write', is_suggestion: false, reason: 'Broad access.',
    }];
    broadened.permissions = {
      can_modify_files: true,
      can_run_commands: false,
      requires_network: true,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    broadened.risk = { level: 'high', reasons: ['Broad file access.'], finding_count: 0 };
    const fake = modelReturning(broadened, broadened);

    const result = await createAgentProposal({
      request: 'Review my manuscript.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{
        question_id: 'file-access',
        value: [{ path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' }],
      }],
      model: fake.model,
    });

    expect(result).toMatchObject({
      status: 'proposal',
      proposal: {
        file_access: [{
          path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only', is_suggestion: false,
        }],
        permissions: { can_modify_files: false },
      },
    });
    expect(fake.calls()).toBe(1);
  });

  it('does not send confirmed local file paths to the proposal model', () => {
    const prompt = buildAgentProposalPrompt(ProposalRequestSchema.parse({
      request: 'Review /Users/test/Private Book/manuscript.docx every morning.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{
        question_id: 'file-access',
        value: [{ path: '/Users/test/Private Book/manuscript.docx', kind: 'file', access: 'read_only' }],
      }],
    }));

    expect(prompt).not.toContain('/Users/test/Private Book');
    expect(prompt).toContain('[selected local item]');
    expect(prompt).toContain('1 selected item');
    expect(prompt).toContain('view only');
  });

  it('rejects relative file grants before requesting a proposal', async () => {
    const fake = modelReturning(completeProposal());

    await expect(createAgentProposal({
      request: 'Review my manuscript.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{
        question_id: 'file-access',
        value: [{ path: 'Books/manuscript.docx', kind: 'file', access: 'read_only' }],
      }],
      model: fake.model,
    })).rejects.toThrow(/absolute/i);
    expect(fake.calls()).toBe(0);
  });

  it('persists every reviewed file grant and never uses a file as the working folder', () => {
    const proposal = completeProposal();
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.permissions = {
      can_modify_files: true,
      can_run_commands: false,
      requires_network: false,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    proposal.risk = { level: 'high', reasons: ['Can update notes.'], finding_count: 0 };
    proposal.file_access = [
      {
        path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only',
        is_suggestion: false, reason: 'Reads the manuscript.',
      },
      {
        path: '~/Books/Notes', kind: 'folder', access: 'read_write',
        is_suggestion: false, reason: 'Stores review notes.',
      },
    ];

    const agent = proposalToAgentConfig(CreationProposalSchema.parse(proposal), 'manuscript-review');

    expect(agent.file_access).toEqual([
      { path: '~/Books/manuscript.docx', kind: 'file', access: 'read_only' },
      { path: '~/Books/Notes', kind: 'folder', access: 'read_write' },
    ]);
    expect(agent.working_directory).toBe('~/Books');
  });

  it('uses authoritative connection names instead of model-provided labels', async () => {
    const proposal = completeProposal();
    proposal.connections = [{
      id: 'notion-personal', name: 'Slack', required: true, status: 'connected', reason: 'Stores the note.',
    }];
    proposal.notification_destination = null;
    proposal.permissions.can_send_messages = false;
    const fake = modelReturning(proposal);

    const result = await createAgentProposal({
      request: 'Store a note in Personal Notion.',
      timezone: 'Europe/Lisbon',
      connectedServices: [{
        id: 'notion-personal', service_id: 'notion', name: 'Personal Notion', source: 'configured_api',
        actions: ['read', 'write'], actions_known: true,
      }],
      answers: [{ question_id: 'connection-notion', value: 'notion-personal' }],
      model: fake.model,
    });

    expect(result).toMatchObject({
      status: 'proposal',
      proposal: { connections: [{ id: 'notion-personal', name: 'Personal Notion', status: 'connected' }] },
    });
  });

  it('does not treat an unrelated text answer as service approval', () => {
    const request = ProposalRequestSchema.parse({
      request: 'Create a daily summary.',
      timezone: 'Europe/Lisbon',
      connectedServices: [{
        id: 'notion-personal', service_id: 'notion', name: 'Personal Notion', source: 'configured_api',
        actions: ['read', 'write'], actions_known: true,
      }],
      answers: [{ question_id: 'expected-result', value: 'notion-personal' }],
    });

    expect(servicesRelevantToRequest(request)).toEqual([]);
  });

  it('keeps an explicitly selected connection required and replaces duplicate model output locally', async () => {
    const selected = completeProposal();
    selected.connections = [{
      id: 'notion-personal', name: 'Wrong', required: false, status: 'optional', reason: 'Stores the note.',
    }];
    selected.notification_destination = null;
    selected.permissions.can_send_messages = false;
    const duplicated = structuredClone(selected);
    duplicated.connections.push(structuredClone(duplicated.connections[0]));
    const service = {
      id: 'notion-personal', service_id: 'notion', name: 'Personal Notion', source: 'configured_api' as const,
      actions: ['read', 'write'] as const, actions_known: true,
    };

    const accepted = await createAgentProposal({
      request: 'Store a note in Notion.', timezone: 'Europe/Lisbon', connectedServices: [service],
      answers: [{ question_id: 'connection-notion', value: 'notion-personal' }],
      model: modelReturning(selected).model,
    });
    const rejected = await createAgentProposal({
      request: 'Store a note in Notion.', timezone: 'Europe/Lisbon', connectedServices: [service],
      answers: [{ question_id: 'connection-notion', value: 'notion-personal' }],
      model: modelReturning(duplicated, duplicated).model,
    });

    expect(accepted).toMatchObject({
      status: 'proposal', proposal: { connections: [{ id: 'notion-personal', required: true }] },
    });
    expect(rejected).toMatchObject({
      status: 'proposal',
      usedFallback: true,
      proposal: { connections: [{ id: 'notion-personal', required: true }] },
    });
    if (rejected.status !== 'proposal') throw new Error('Expected proposal');
    expect(rejected.proposal.connections).toHaveLength(1);
  });

  it('raises the proposal risk for read-only access to sensitive files', async () => {
    const proposal = completeProposal();
    proposal.connections = [];
    proposal.notification_destination = null;
    proposal.permissions = {
      can_modify_files: false,
      can_run_commands: false,
      requires_network: false,
      can_use_connected_apps: false,
      can_send_messages: false,
    };
    proposal.risk = { level: 'low', reasons: [], finding_count: 0 };
    const fake = modelReturning(proposal);

    const result = await createAgentProposal({
      request: 'Review my SSH configuration.',
      timezone: 'Europe/Lisbon',
      connectedServices: [],
      answers: [{
        question_id: 'file-access',
        value: [{ path: '~/.ssh/config', kind: 'file', access: 'read_only' }],
      }],
      model: fake.model,
    });

    expect(result).toMatchObject({
      status: 'proposal',
      proposal: { risk: { level: 'high', reasons: expect.arrayContaining([expect.stringMatching(/SSH/i)]) } },
    });
  });
});
