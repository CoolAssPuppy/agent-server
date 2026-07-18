import { Hono } from 'hono';
import { z } from 'zod';
import type { AgentConfig } from '../agents/config.js';
import { sanitizeStructuredValue, sanitizeText } from '../server/security-utils.js';
import {
  ConfigurationPatchSchema,
  PatchConflictError,
  PatchPolicyError,
  type PatchApplyResult,
  type PatchPreview,
  type StructuredPatchService,
} from './patch.js';
import type { SecurityAnalysisService } from './security-service.js';

export type SecurityContentSource = {
  get(agentId: string): Promise<{ agent: AgentConfig; content: string } | undefined>;
  list(): Promise<Array<{ agent: AgentConfig; content: string }>>;
};

export type AnalysisApiDependencies = {
  security: SecurityAnalysisService;
  patches: StructuredPatchService;
  content: SecurityContentSource;
};

const ReviewRequestSchema = z.object({
  content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  acknowledged_finding_ids: z.array(z.string().trim().min(1).max(200)).max(500),
}).strict();

const RollbackRequestSchema = z.object({ rollback_token: z.string().uuid() }).strict();

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new TypeError('Expected Content-Type: application/json');
  }
  return JSON.parse(await request.text()) as unknown;
}

function publicPreview(preview: PatchPreview | PatchApplyResult): Record<string, unknown> {
  const advancedChanges: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(preview.patch.changes)) {
    advancedChanges[field] = field === 'prompt'
      ? '[Updated instructions]'
      : sanitizeStructuredValue(value);
  }
  return {
    original_content_hash: preview.original_content_hash,
    result_content_hash: preview.result_content_hash,
    source: preview.patch.source,
    reason: sanitizeText(preview.patch.reason, 1_000),
    changes: preview.changes,
    advanced_changes: advancedChanges,
    risk: preview.risk,
    risk_reasons: preview.risk_reasons,
    requires_confirmation: preview.requires_confirmation,
    can_apply: preview.can_apply,
    ...('rollback_token' in preview ? { rollback_token: preview.rollback_token } : {}),
  };
}

export function createAnalysisApi(dependencies: AnalysisApiDependencies): Hono {
  const app = new Hono();

  app.get('/security/agents/:id', async (context) => {
    const input = await dependencies.content.get(context.req.param('id'));
    if (!input) return context.json({ error: 'Agent not found' }, 404);
    return context.json(await dependencies.security.analyze(input));
  });

  app.post('/security/scan', async (context) => {
    return context.json(await dependencies.security.scan(await dependencies.content.list()));
  });

  app.post('/security/agents/:id/review', async (context) => {
    try {
      const body = ReviewRequestSchema.parse(await readJson(context.req.raw));
      const reviewed = dependencies.security.markReviewed({
        agent_id: context.req.param('id'),
        content_hash: body.content_hash,
        acknowledged_finding_ids: body.acknowledged_finding_ids,
      });
      return reviewed
        ? context.json({ reviewed: true })
        : context.json({ error: 'The agent changed. Run the security check again.' }, 409);
    } catch (error) {
      return context.json({ error: error instanceof TypeError ? error.message : 'Invalid review request' }, 400);
    }
  });

  app.post('/configuration-patches/preview', async (context) => {
    try {
      const patch = ConfigurationPatchSchema.parse(await readJson(context.req.raw));
      return context.json(publicPreview(await dependencies.patches.preview(patch)));
    } catch (error) {
      if (error instanceof PatchConflictError) return context.json({ error: error.message }, 409);
      if (error instanceof PatchPolicyError) return context.json({ error: error.message }, 422);
      return context.json({ error: error instanceof TypeError ? error.message : 'Invalid configuration patch' }, 400);
    }
  });

  app.post('/configuration-patches/apply', async (context) => {
    try {
      const patch = ConfigurationPatchSchema.parse(await readJson(context.req.raw));
      return context.json(publicPreview(await dependencies.patches.apply(patch)));
    } catch (error) {
      if (error instanceof PatchConflictError) return context.json({ error: error.message }, 409);
      if (error instanceof PatchPolicyError) return context.json({ error: error.message }, 422);
      return context.json({ error: error instanceof TypeError ? error.message : 'Invalid configuration patch' }, 400);
    }
  });

  app.post('/configuration-patches/rollback', async (context) => {
    try {
      const body = RollbackRequestSchema.parse(await readJson(context.req.raw));
      await dependencies.patches.rollback(body.rollback_token);
      return context.json({ rolled_back: true });
    } catch (error) {
      if (error instanceof PatchConflictError) return context.json({ error: error.message }, 409);
      return context.json({ error: error instanceof TypeError ? error.message : 'Rollback is not available' }, 400);
    }
  });

  return app;
}
