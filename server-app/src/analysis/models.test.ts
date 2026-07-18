import { describe, expect, it } from 'vitest';
import {
  AgentProposalSchema,
  DiagnosticResultSchema,
  FindingSchema,
  SecurityAnalysisSchema,
} from './models.js';

const lowRiskFinding = {
  id: 'finding-read-only',
  rule_id: 'permissions.read_only',
  severity: 'low',
  title: 'Files are read-only',
  explanation: 'The agent can review the selected folder without changing it.',
  potential_impact: 'Files stay unchanged.',
  trigger: 'Read-only access to one selected folder.',
  evidence: [{ code: 'path', label: 'Selected folder', detail: '~/Documents/Reports', source: 'configuration' }],
  recommendation: {
    id: 'keep-read-only',
    label: 'Keep read-only access',
    description: 'No change is needed.',
    kind: 'manual',
    risk: 'low',
    requires_confirmation: false,
    affects_functionality: false,
  },
  can_ignore: true,
  model_generated: false,
  confidence: 1,
} as const;

describe('analysis models', () => {
  it('accepts a complete least-privilege agent proposal', () => {
    const proposal = AgentProposalSchema.parse({
      schema_version: 1,
      name: 'Friday GitHub summary',
      description: 'Reviews GitHub activity and prepares a short summary.',
      instructions: 'Review activity from the last seven days and summarize it.',
      explanation: 'It reads GitHub activity every Friday and prepares a short Slack message.',
      trigger: { type: 'schedule', schedule: '0 17 * * 5', human_description: 'Every Friday at 5:00 p.m.' },
      timezone: 'Europe/Lisbon',
      capabilities: [{ id: 'github', name: 'GitHub', required: true, status: 'connected', reason: 'Reads activity.' }],
      connections: [{ id: 'slack', name: 'Slack', required: true, status: 'needs_setup', reason: 'Sends the summary.' }],
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
      risk: { level: 'needs_review', reasons: ['It sends information to Slack.'], finding_count: 1 },
      missing_information: [],
      questions: [],
      markdown_instructions: '# Goal\n\nPrepare a short weekly summary.',
    });

    expect(proposal.permissions.can_run_commands).toBe(false);
    expect(proposal.trigger.human_description).toContain('Friday');
  });

  it('rejects uncontrolled proposal fields and incomplete permissions', () => {
    const result = AgentProposalSchema.safeParse({
      schema_version: 1,
      name: 'Unsafe proposal',
      description: 'Missing required fields.',
      surprise_yaml: 'danger-full-access',
    });

    expect(result.success).toBe(false);
  });

  it('requires redacted, bounded evidence for a finding', () => {
    expect(FindingSchema.parse(lowRiskFinding).confidence).toBe(1);
    expect(FindingSchema.safeParse({ ...lowRiskFinding, confidence: 2 }).success).toBe(false);
  });

  it('validates deterministic and model-assisted diagnosis results', () => {
    const result = DiagnosticResultSchema.parse({
      schema_version: 1,
      run_id: 'run-1',
      summary: 'The agent could not save the report.',
      most_likely_cause: 'File editing is turned off.',
      confidence: 0.98,
      evidence: lowRiskFinding.evidence,
      suggested_fix: lowRiskFinding.recommendation,
      affected_settings: ['Files this agent can access'],
      risk: 'needs_review',
      can_automate: true,
      rerun_safety: 'confirm',
      alternatives: [],
      next_step: 'Review the proposed folder permission.',
      source: 'deterministic',
    });

    expect(result.source).toBe('deterministic');
  });

  it('binds security analysis to content hash and analyzer version', () => {
    const result = SecurityAnalysisSchema.parse({
      schema_version: 1,
      agent_id: 'weekly-summary',
      content_hash: 'sha256:abc123',
      analyzer_version: '1.0.0',
      analyzed_at: '2026-07-18T12:00:00.000Z',
      risk: { level: 'low', reasons: [], finding_count: 1 },
      findings: [lowRiskFinding],
      is_stale: false,
      model_status: 'not_needed',
    });

    expect(result.content_hash).toBe('sha256:abc123');
  });
});
