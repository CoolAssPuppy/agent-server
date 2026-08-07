import { StructuredPatchService } from '../src/analysis/patch.js';
import { FileAgentContentRepository } from '../src/analysis/patch-repository.js';
import { computeAgentContentHash } from '../src/analysis/security-rules.js';
import { parseAgentFile } from '../src/agents/config.js';
import type { AgentConnectionUses } from '../src/agents/connection-uses.js';

const agentsDir = process.env.AGENT_MIGRATION_DIR
  ?? '/Users/prashant/Developer/brain/agents/agents';
const shouldApply = process.argv.includes('--apply');

type Migration = {
  connections: AgentConnectionUses;
  outputUse: string;
  outputOperation: string;
  outputTarget: string;
  replacements: Readonly<Record<string, string>>;
};

const resource = (type: string, purpose: string, access: 'read' | 'write' | 'read_write') => ({
  type, purpose, access,
});

const slack = {
  type: 'slack', name: 'Slack Work',
  purpose: 'Read work messages that involve Prashant.',
  operations: [
    'slack.user.search', 'slack.user.read', 'slack.channel.read',
    'slack.thread.read', 'slack.message.search',
  ],
  resources: { subject_user: resource('slack.user', 'Prashant in Slack', 'read') },
};

const linear = {
  type: 'linear', name: 'Linear Work',
  purpose: 'Read work assigned to or involving Prashant.',
  operations: [
    'linear.user.list', 'linear.issue.list', 'linear.issue.read', 'linear.comment.list',
    'linear.project.list', 'linear.project.read', 'linear.initiative.list',
    'linear.initiative.read',
  ],
  resources: { subject_user: resource('linear.user', 'Prashant in Linear', 'read') },
};

const workNotion = (databaseKey: string, purpose: string) => ({
  type: 'notion', name: 'Notion Work', purpose,
  operations: [
    'notion.search', 'notion.page.read', 'notion.data_source.query', 'notion.page.create',
  ],
  resources: { [databaseKey]: resource('notion.data_source', purpose, 'read_write') },
});

const personalNotion = (databaseKey: string, purpose: string, includeSearch = false) => ({
  type: 'notion', name: 'Notion Personal', purpose,
  operations: [
    ...(includeSearch ? ['notion.search', 'notion.data_source.read'] : []),
    'notion.data_source.query', 'notion.page.read', 'notion.page.create',
  ],
  resources: { [databaseKey]: resource('notion.data_source', purpose, 'read_write') },
});

const commonReplacements: Record<string, string> = {
  'The `notion-personal` server': 'The connection assigned to `personal_notes`',
  '`prashant_sridharan@hotmail.com`': '`work_projects.subject_user`',
  'mcp__claude_ai_Slack__slack_search_public_and_private': 'slack.message.search through work_messages',
  'mcp__claude_ai_Slack__slack_search_users': 'slack.user.search through work_messages',
  'mcp__claude_ai_Slack__slack_read_channel': 'slack.channel.read through work_messages',
  'mcp__claude_ai_Slack__slack_read_thread': 'slack.thread.read through work_messages',
  slack_search_public_and_private: 'slack.message.search through work_messages',
  slack_search_users: 'slack.user.search through work_messages',
  slack_read_thread: 'slack.thread.read through work_messages',
  'mcp__claude_ai_Notion__notion-query-data-sources': 'notion.data_source.query through work_notes',
  'mcp__claude_ai_Notion__notion-query-meeting-notes': 'notion.meeting_notes.query through work_notes',
  'mcp__claude_ai_Notion__notion-create-pages': 'notion.page.create through work_notes',
  'mcp__claude_ai_Notion__notion-search': 'notion.search through work_notes',
  'mcp__claude_ai_Notion__notion-fetch': 'notion.page.read through work_notes',
  'notion-query-meeting-notes': 'notion.meeting_notes.query through work_notes',
  'notion-fetch': 'notion.page.read through work_notes',
  'notion-search': 'notion.search through work_notes',
  list_users: 'linear.user.list through work_projects',
  list_issues: 'linear.issue.list through work_projects',
  list_projects: 'linear.project.list through work_projects',
  get_project: 'linear.project.read through work_projects',
  get_initiative: 'linear.initiative.read through work_projects',
  'mcp__notion-personal__API-post-search': 'notion.search through personal_notes',
  'mcp__notion-personal__API-retrieve-a-data-source': 'notion.data_source.read through personal_notes',
  'mcp__notion-personal__API-query-data-source': 'notion.data_source.query through personal_notes',
  'mcp__notion-personal__API-retrieve-page-markdown': 'notion.page.read through personal_notes',
  'mcp__notion-personal__API-post-page': 'notion.page.create through personal_notes',
  'mcp__notion-personal__': 'personal_notes',
  'mcp__claude_ai_Notion__': 'work_notes',
  'mcp__claude_ai_Slack__': 'work_messages',
  'mcp__claude_ai_Linear__': 'work_projects',
  'mcp__claude_ai_Gmail__': 'work_mail',
  'mcp__claude_ai_Google_Calendar__': 'work_calendar',
};

const migrations: Record<string, Migration> = {
  'daily-portuguese-and-french': {
    connections: { personal_notes: personalNotion('lesson_database', 'Read prior lessons and create daily lesson pages.') },
    outputUse: 'personal_notes', outputOperation: 'notion.page.create', outputTarget: 'lesson_database',
    replacements: { '255a555c-5905-80c0-9c85-000bc083f813': 'personal_notes.lesson_database' },
  },
  'daily-manuscript-review': {
    connections: { personal_notes: personalNotion('review_database', 'Read prior reviews and create a manuscript review.', true) },
    outputUse: 'personal_notes', outputOperation: 'notion.page.create', outputTarget: 'review_database',
    replacements: { '255a555c-5905-80c0-9c85-000bc083f813': 'personal_notes.review_database' },
  },
  'cmo-coaching': {
    connections: {
      work_messages: slack,
      work_projects: linear,
      work_notes: {
        type: 'notion', name: 'Notion Work', purpose: 'Read work pages and meeting notes.',
        operations: ['notion.search', 'notion.page.read', 'notion.meeting_notes.query'], resources: {},
      },
      personal_notes: personalNotion('report_database', 'Read prior coaching reports and create one new report.'),
    },
    outputUse: 'personal_notes', outputOperation: 'notion.page.create', outputTarget: 'report_database',
    replacements: {
      '255a555c-5905-80c0-9c85-000bc083f813': 'personal_notes.report_database',
      U087GTN6HFB: 'work_messages.subject_user',
    },
  },
  'daily-focus': {
    connections: {
      work_messages: slack,
      work_projects: linear,
      work_notes: workNotion('focus_database', 'Read work pages and create the daily focus page.'),
      work_mail: {
        type: 'gmail', name: 'Gmail Work', purpose: 'Read work mail involving Prashant.',
        operations: ['gmail.thread.search', 'gmail.thread.read', 'gmail.message.read', 'gmail.label.list'], resources: {},
      },
      work_calendar: {
        type: 'calendar', name: 'Calendar Work', purpose: 'Read work calendars and events.',
        operations: ['calendar.calendar.list', 'calendar.event.list', 'calendar.event.read', 'calendar.event.search'], resources: {},
      },
    },
    outputUse: 'work_notes', outputOperation: 'notion.page.create', outputTarget: 'focus_database',
    replacements: {
      '8dd5004b-775f-8339-b38f-87b1e08ebe79': 'work_notes.focus_database',
      U087GTN6HFB: 'work_messages.subject_user',
    },
  },
  'proactive-work': {
    connections: {
      work_messages: slack,
      work_projects: linear,
      work_notes: workNotion('draft_database', 'Read work pages and create head-start drafts.'),
      customer_messaging: {
        type: 'customer_io', name: 'Customer.io Work', purpose: 'Read campaign structure and examples.',
        operations: [
          'customer_io.auth.read', 'customer_io.content.read', 'customer_io.skill.list',
          'customer_io.skill.read', 'customer_io.schema.read',
        ], resources: {},
      },
    },
    outputUse: 'work_notes', outputOperation: 'notion.page.create', outputTarget: 'draft_database',
    replacements: { '8dd5004b-775f-8339-b38f-87b1e08ebe79': 'work_notes.draft_database' },
  },
  'weekly-goals-report': {
    connections: {
      work_messages: slack, work_projects: linear,
      work_notes: workNotion('report_database', 'Read prior goals and create the weekly goals report.'),
    },
    outputUse: 'work_notes', outputOperation: 'notion.page.create', outputTarget: 'report_database',
    replacements: {
      '8dd5004b-775f-8339-b38f-87b1e08ebe79': 'work_notes.report_database',
      U087GTN6HFB: 'work_messages.subject_user',
    },
  },
  'weekly-status-report': {
    connections: {
      work_messages: slack, work_projects: linear,
      work_notes: workNotion('report_database', 'Read prior status reports and create the weekly status report.'),
    },
    outputUse: 'work_notes', outputOperation: 'notion.page.create', outputTarget: 'report_database',
    replacements: {
      '8dd5004b-775f-8339-b38f-87b1e08ebe79': 'work_notes.report_database',
      U087GTN6HFB: 'work_messages.subject_user',
    },
  },
};

function portablePrompt(prompt: string, replacements: Readonly<Record<string, string>>): string {
  let result = prompt;
  for (const [before, after] of Object.entries({ ...commonReplacements, ...replacements })) {
    result = result.replaceAll(before, after);
  }
  result = result.replace(/mcp__CustomerIO__cio_auth_status/g, 'customer_io.auth.read through customer_messaging');
  result = result.replace(/mcp__CustomerIO__cio_read_api|cio_read_api/g, 'customer_io.content.read through customer_messaging');
  result = result.replace(/mcp__CustomerIO__cio_skills_list|cio_skills_list/g, 'customer_io.skill.list through customer_messaging');
  result = result.replace(/mcp__CustomerIO__cio_skills_read|cio_skills_read/g, 'customer_io.skill.read through customer_messaging');
  result = result.replace(/mcp__CustomerIO__cio_schema/g, 'customer_io.schema.read through customer_messaging');
  return result;
}

const repository = new FileAgentContentRepository(agentsDir);
const service = new StructuredPatchService(repository);

for (const [agentId, migration] of Object.entries(migrations)) {
  const content = await repository.read(agentId);
  const agent = parseAgentFile(content);
  const output = agent.output ? {
    ...agent.output,
    primary: {
      description: portablePrompt(agent.output.primary.description, migration.replacements),
      use: migration.outputUse,
      operation: migration.outputOperation,
      target: migration.outputTarget,
      ...('required' in agent.output.primary && agent.output.primary.required !== undefined
        ? { required: agent.output.primary.required } : {}),
      ...('successful_calls' in agent.output.primary && agent.output.primary.successful_calls
        ? { successful_calls: agent.output.primary.successful_calls } : {}),
    },
    ...(agent.output.notification ? {
      notification: {
        ...(agent.output.notification.description ? {
          description: portablePrompt(
            agent.output.notification.description,
            migration.replacements,
          ),
        } : {}),
      },
    } : {}),
  } : undefined;
  const patch = {
    schema_version: 1 as const,
    agent_id: agentId,
    expected_content_hash: computeAgentContentHash(content),
    source: 'user' as const,
    reason: 'Move runtime and connection implementation details into machine-local Agent Server settings.',
    changes: {
      prompt: portablePrompt(agent.prompt, migration.replacements),
      connections: migration.connections,
      tools: agent.tools.filter((tool) => !tool.startsWith('mcp__')),
      disallowed_tools: agent.disallowed_tools.filter((tool) => !tool.startsWith('mcp__')),
      permissions: agent.permissions ? {
        allow: agent.permissions.allow.filter((tool) => !tool.startsWith('mcp__')),
        deny: agent.permissions.deny.filter((tool) => !tool.startsWith('mcp__')),
      } : undefined,
      mcp_servers: null,
      output,
      ...(agentId === 'daily-manuscript-review' ? { codex_sandbox: null } : {}),
    },
  };
  const preview = await service.preview(patch);
  console.log(`${agentId}\t${preview.original_content_hash}\t${preview.result_content_hash}\t${preview.risk}`);
  if (shouldApply) {
    await service.apply({
      ...patch,
      confirmation: { approved: true as const, preview_content_hash: preview.result_content_hash },
    });
  }
}
