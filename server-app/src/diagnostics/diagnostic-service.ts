import { z } from 'zod';
import { DiagnosticResultSchema, type DiagnosticResult } from '../analysis/models.js';
import { buildDiagnosticPrompt } from './diagnostic-prompt.js';
import { runLocalDiagnosticRules } from './diagnostic-rules.js';
import type { DiagnosticInput } from './diagnostic-types.js';

export { buildDiagnosticPrompt } from './diagnostic-prompt.js';
export { guardRepairProposal } from './repair-schema.js';
export type { DiagnosticModel, DiagnosticReadiness } from './diagnostic-types.js';

function parseModelResult(value: unknown): DiagnosticResult | undefined {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }
  const parsed = DiagnosticResultSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.source !== 'model') return undefined;
  const isHighRisk = parsed.data.risk === 'high' || parsed.data.risk === 'critical';
  if (isHighRisk && (
    parsed.data.can_automate
    || !parsed.data.suggested_fix.requires_confirmation
    || parsed.data.rerun_safety === 'safe'
  )) return undefined;
  return parsed.data;
}

function unknownFailure(input: DiagnosticInput): DiagnosticResult {
  return {
    schema_version: 1,
    run_id: input.run.runId,
    summary: 'The run stopped for a reason the app could not verify.',
    most_likely_cause: 'There is not enough local evidence to identify one cause.',
    confidence: 0,
    evidence: [{
      code: 'unclassified-failure',
      label: 'Run stopped',
      detail: input.run.error ?? 'No error details were recorded.',
      source: 'run',
    }],
    suggested_fix: {
      id: 'review-technical-details',
      label: 'Review technical details',
      description: 'Review the redacted run details before deciding whether to retry.',
      kind: 'manual',
      risk: 'needs_review',
      requires_confirmation: true,
      affects_functionality: false,
    },
    affected_settings: [],
    risk: 'needs_review',
    can_automate: false,
    rerun_safety: 'confirm',
    alternatives: [],
    next_step: 'Open technical details or retry when you know the cause was temporary.',
    source: 'deterministic',
  };
}

/** Diagnose locally first, then use an optional model only for unexplained failures. */
export async function analyzeRunFailure(input: DiagnosticInput): Promise<DiagnosticResult> {
  const local = runLocalDiagnosticRules(input);
  if (local) return DiagnosticResultSchema.parse(local);
  if (!input.model) return DiagnosticResultSchema.parse(unknownFailure(input));

  const outputSchema = z.toJSONSchema(DiagnosticResultSchema, { unrepresentable: 'any' }) as Record<string, unknown>;
  const attempts = input.model.handlesRetries ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await input.model.generate(buildDiagnosticPrompt(input), outputSchema, {
        requestKey: `run-diagnostic:${input.run.runId}`,
      });
      const diagnosis = parseModelResult(value);
      if (diagnosis) return diagnosis;
    } catch {
      // A bounded retry handles transient local runtime and schema failures.
    }
  }
  return DiagnosticResultSchema.parse(unknownFailure(input));
}
