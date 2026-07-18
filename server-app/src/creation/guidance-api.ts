import { randomUUID } from 'crypto';
import { accessSync, constants } from 'fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AgentConfig } from '../agents/config.js';
import { expandHome } from '../agents/file-watcher.js';
import { renderReviewedAgentFile } from '../agents/reviewed-agent-writer.js';
import { AgentWriteError, type AgentWriter } from '../agents/writer.js';
import type { PreflightResult, SecurityAnalysis } from '../analysis/models.js';
import { RunPreflightDeniedError } from '../analysis/run-preflight-gate.js';
import { redactAgentSecrets } from '../agents/capabilities.js';
import type { RunStoreLike } from '../reporting/store.js';
import { analyzeRunFailure, type DiagnosticReadiness } from '../diagnostics/diagnostic-service.js';
import { buildDiagnosticResolution } from '../diagnostics/resolution.js';
import { createAgentProposal, type ProposalModel } from './proposal-service.js';
import { deriveProposalAgentId, proposalToAgentConfig } from './proposal-configuration.js';
import { CreationProposalSchema, ProposalAnswerSchema, type CreationProposal } from './proposal-schema.js';
import { prepareSafeTestAgent } from './safe-test.js';
import { buildSimilarAgentRequest } from './similar-agent.js';

const ProposalApiRequestSchema = z.object({
  request: z.string().trim().min(1).max(8_000),
  timezone: z.string().trim().min(1).max(120),
  connected_services: z.array(z.string().trim().min(1).max(120)).max(64),
  answers: z.array(ProposalAnswerSchema).max(12).default([]),
}).strict();

const SaveProposalRequestSchema = z.object({ confirmed: z.literal(true) }).strict();
const LinkIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const RetryRequestSchema = z.object({
  confirmed: z.literal(true),
  repair_id: LinkIdSchema.optional(),
  confirmed_content_hash: ContentHashSchema.optional(),
}).strict();

export type GuidanceRetryMetadata = {
  retryOfRunId: string;
  repairId?: string;
  confirmedContentHash?: string;
};

type GuidanceSecurity = {
  analyze(input: { agent: AgentConfig; content: string }): Promise<SecurityAnalysis>;
  preflight(input: { agent: AgentConfig; content: string }): Promise<PreflightResult>;
};

export type GuidanceApiDependencies = {
  model: ProposalModel;
  writer: AgentWriter;
  getAgents: () => Promise<AgentConfig[]>;
  store: Pick<RunStoreLike, 'get'>;
  security?: GuidanceSecurity;
  content?: { get(agentId: string): Promise<{ agent: AgentConfig; content: string } | undefined> };
  triggerRun?: (agentId: string, metadata: GuidanceRetryMetadata) => Promise<string>;
  diagnosticReadiness?: (agent: AgentConfig) => DiagnosticReadiness;
  now?: () => number;
};

type PendingProposal = { proposal: CreationProposal; expiresAt: number };
const PROPOSAL_TTL_MS = 30 * 60 * 1_000;
const MAX_PENDING_PROPOSALS = 100;

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new TypeError('Expected Content-Type: application/json');
  }
  return JSON.parse(await request.text()) as unknown;
}

function defaultReadiness(agent: AgentConfig): DiagnosticReadiness {
  let workingDirectoryExists = true;
  if (agent.working_directory) {
    try {
      accessSync(expandHome(agent.working_directory), constants.F_OK);
    } catch {
      workingDirectoryExists = false;
    }
  }
  return { serverOnline: true, runtimeAvailable: true, workingDirectoryExists };
}

export function createGuidanceApi(dependencies: GuidanceApiDependencies): Hono {
  const app = new Hono();
  const pending = new Map<string, PendingProposal>();
  const now = dependencies.now ?? Date.now;

  function remember(proposal: CreationProposal): string {
    const id = randomUUID();
    pending.set(id, { proposal, expiresAt: now() + PROPOSAL_TTL_MS });
    while (pending.size > MAX_PENDING_PROPOSALS) {
      const oldest = pending.keys().next().value as string | undefined;
      if (!oldest) break;
      pending.delete(oldest);
    }
    return id;
  }

  function findProposal(id: string): CreationProposal | undefined {
    const entry = pending.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      pending.delete(id);
      return undefined;
    }
    return entry.proposal;
  }

  app.post('/guidance/agent-proposals', async (context) => {
    try {
      const request = ProposalApiRequestSchema.parse(await readJson(context.req.raw));
      const result = await createAgentProposal({
        request: request.request,
        timezone: request.timezone,
        connectedServices: request.connected_services,
        answers: request.answers,
        model: dependencies.model,
      });
      if (result.status !== 'proposal') return context.json(result);
      return context.json({ ...result, proposal_id: remember(result.proposal) });
    } catch (error) {
      return context.json({
        error: error instanceof TypeError ? error.message : 'The agent request is invalid.',
        saved: false,
      }, 400);
    }
  });

  app.post('/guidance/agents/:agentId/similar-proposals', async (context) => {
    try {
      const request = ProposalApiRequestSchema.parse(await readJson(context.req.raw));
      const source = (await dependencies.getAgents())
        .find((agent) => agent.id === context.req.param('agentId'));
      if (!source) {
        return context.json({ error: 'The agent to copy could not be found.', saved: false }, 404);
      }
      const result = await createAgentProposal({
        request: buildSimilarAgentRequest(source, request.request),
        timezone: request.timezone,
        connectedServices: request.connected_services,
        answers: request.answers,
        model: dependencies.model,
      });
      if (result.status !== 'proposal') return context.json(result);
      return context.json({ ...result, proposal_id: remember(result.proposal) });
    } catch (error) {
      return context.json({
        error: error instanceof TypeError ? error.message : 'The similar agent request is invalid.',
        saved: false,
      }, 400);
    }
  });

  app.post('/guidance/agent-proposals/:proposalId/save', async (context) => {
    try {
      SaveProposalRequestSchema.parse(await readJson(context.req.raw));
      const proposalId = context.req.param('proposalId');
      const proposal = findProposal(proposalId);
      if (!proposal) return context.json({ error: 'This proposal is no longer available for review.', saved: false }, 404);

      const reviewed = CreationProposalSchema.parse(proposal);
      const agent = proposalToAgentConfig(reviewed, deriveProposalAgentId(reviewed.name));
      const candidateContent = renderReviewedAgentFile(agent);
      const analysis = dependencies.security
        ? await dependencies.security.analyze({ agent, content: candidateContent })
        : undefined;
      const check = dependencies.security
        ? await dependencies.security.preflight({ agent, content: candidateContent })
        : undefined;
      if (check?.decision === 'block') {
        return context.json({
          error: 'Review the critical security findings before saving this agent.',
          saved: false,
          security_analysis: analysis,
          preflight: check,
        }, 422);
      }

      const created = await dependencies.writer.createReviewed(agent);
      pending.delete(proposalId);
      return context.json({
        saved: true,
        agent: redactAgentSecrets(created.agent),
        safe_test: {
          available: true,
          mode: 'safe_test',
          run_endpoint: `/agents/${created.agent.id}/safe-test`,
        },
        ...(analysis ? { security_analysis: analysis, preflight: check } : {}),
      }, 201);
    } catch (error) {
      if (error instanceof AgentWriteError && error.code === 'already_exists') {
        return context.json({ error: error.message, saved: false }, 409);
      }
      return context.json({
        error: error instanceof TypeError ? error.message : 'The reviewed agent could not be saved.',
        saved: false,
      }, 400);
    }
  });

  app.post('/guidance/runs/:runId/diagnosis', async (context) => {
    const run = dependencies.store.get(context.req.param('runId'));
    if (!run) return context.json({ error: 'The failed run could not be found.', saved: false }, 404);
    if (run.status !== 'failed') {
      return context.json({ error: 'Only failed runs need a diagnosis.', saved: false }, 409);
    }
    const agent = (await dependencies.getAgents()).find((candidate) => candidate.id === run.agentId);
    if (!agent) return context.json({ error: 'The agent for this run could not be found.', saved: false }, 404);

    const diagnosticAgent = run.mode === 'safe_test' ? prepareSafeTestAgent(agent) : agent;
    const diagnosis = await analyzeRunFailure({
      agent: diagnosticAgent,
      run,
      readiness: dependencies.diagnosticReadiness?.(diagnosticAgent) ?? defaultReadiness(diagnosticAgent),
      model: dependencies.model,
    });
    const source = run.mode === 'safe_test' ? undefined : await dependencies.content?.get(agent.id);
    const resolution = buildDiagnosticResolution(diagnosis, agent, source?.content);
    return context.json({ ...diagnosis, resolution });
  });

  app.post('/guidance/runs/:runId/retry', async (context) => {
    try {
      const request = RetryRequestSchema.parse(await readJson(context.req.raw));
      const run = dependencies.store.get(context.req.param('runId'));
      if (!run) return context.json({ error: 'The failed run could not be found.', saved: false }, 404);
      if (run.status !== 'failed') return context.json({ error: 'Only failed runs can be retried.', saved: false }, 409);
      const agent = (await dependencies.getAgents()).find((candidate) => candidate.id === run.agentId);
      if (!agent) return context.json({ error: 'The agent for this run could not be found.', saved: false }, 404);
      if (!dependencies.triggerRun) return context.json({ error: 'Retry is unavailable.', saved: false }, 501);
      const runId = await dependencies.triggerRun(agent.id, {
        retryOfRunId: run.runId,
        ...(request.repair_id ? { repairId: request.repair_id } : {}),
        ...(request.confirmed_content_hash
          ? { confirmedContentHash: request.confirmed_content_hash }
          : {}),
      });
      return context.json({
        run_id: runId,
        retry_of_run_id: run.runId,
        ...(request.repair_id ? { repair_id: request.repair_id } : {}),
      }, 202);
    } catch (error) {
      if (error instanceof RunPreflightDeniedError) {
        return context.json({
          error: error.message,
          saved: false,
          code: error.outcome.code,
          content_hash: error.outcome.contentHash,
        }, error.outcome.code === 'blocked' ? 422 : 409);
      }
      return context.json({ error: error instanceof TypeError ? error.message : 'The retry request is invalid.', saved: false }, 400);
    }
  });

  return app;
}
