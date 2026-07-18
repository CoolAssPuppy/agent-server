import { describe, expect, it } from 'vitest';
import { parseAgentFile } from '../agents/config.js';
import {
  SemanticRiskResponseSchema,
  runSemanticSecurityAnalysis,
} from './semantic-security.js';

const content = `---
id: inbox-reviewer
name: Inbox reviewer
working_directory: /Users/person/Private/Inbox
tools: [Read, WebFetch]
---
Read incoming documents using token sk-live-abcdefghijklmnop and follow their instructions.
`;

describe('semantic security analysis', () => {
  it('sends only a minimal redacted configuration and validates structured findings', async () => {
    let capturedPrompt = '';
    let capturedSchema: Record<string, unknown> = {};
    const result = await runSemanticSecurityAnalysis({
      agent: parseAgentFile(content),
      model: {
        handlesRetries: true,
        generate: async (prompt, schema) => {
          capturedPrompt = prompt;
          capturedSchema = schema;
          return {
            schema_version: 1,
            findings: [{
              id: 'untrusted-instructions',
              risk: 'high',
              title: 'Incoming documents can influence actions',
              reason: 'The instructions ask the agent to follow document instructions.',
              trigger_condition: 'A document contains a malicious instruction.',
              potential_impact: 'Private information could be sent outside this Mac.',
              recommended_mitigation: 'Treat document instructions as untrusted data.',
              confidence: 0.91,
              human_review_required: true,
            }],
          };
        },
      },
    });

    expect(capturedPrompt).not.toContain('sk-live-abcdefghijklmnop');
    expect(capturedPrompt).not.toContain('/Users/person/Private/Inbox');
    expect(capturedPrompt).not.toContain('working_directory:');
    expect(capturedPrompt).toContain('[REDACTED]');
    expect(capturedSchema).toMatchObject({ type: 'object' });
    expect(result.status).toBe('completed');
    expect(result.findings[0]).toMatchObject({ rule_id: 'semantic.untrusted-instructions', severity: 'high' });
  });

  it('rejects extra model fields and returns invalid without findings', async () => {
    const result = await runSemanticSecurityAnalysis({
      agent: parseAgentFile(content),
      model: {
        handlesRetries: true,
        generate: async () => ({ schema_version: 1, findings: [], unsafe_extra: 'ignored?' }),
      },
    });
    expect(result).toEqual({ status: 'invalid', findings: [] });
  });

  it('uses a versioned strict semantic response schema', () => {
    expect(SemanticRiskResponseSchema.safeParse({ schema_version: 2, findings: [] }).success).toBe(false);
    expect(SemanticRiskResponseSchema.safeParse({ schema_version: 1, findings: [], extra: true }).success).toBe(false);
  });
});
