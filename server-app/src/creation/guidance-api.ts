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
import {
  createAgentProposal,
  ProposalGenerationUnavailableError,
  servicesRelevantToRequest,
  type ProposalModel,
} from './proposal-service.js';
import {
  deriveProposalAgentId,
  proposalToAgentConfig,
  type ProposalServiceBinding,
} from './proposal-configuration.js';
import {
  ConnectedServiceInputSchema,
  CreationProposalSchema,
  ProposalAnswerSchema,
  type CreationProposal,
} from './proposal-schema.js';
import { prepareSafeTestAgent } from './safe-test.js';
import { buildSimilarAgentRequest } from './similar-agent.js';
import type { ServiceConnection, ServiceRegistry } from '../services/registry.js';

const ProposalApiRequestSchema = z.object({
  request: z.string().trim().min(1).max(8_000),
  timezone: z.string().trim().min(1).max(120),
  connected_services: z.array(ConnectedServiceInputSchema).max(64),
  available_calendars: z.array(z.object({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(160),
    account: z.string().trim().min(1).max(160),
    can_modify: z.boolean(),
  }).strict()).max(128).default([]),
  available_reminder_lists: z.array(z.object({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(160),
    account: z.string().trim().min(1).max(160),
    can_modify: z.boolean(),
  }).strict()).max(128).default([]),
  available_contact_groups: z.array(z.object({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(160),
    account: z.string().trim().min(1).max(160),
  }).strict()).max(128).default([]),
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

function proposalRequestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError
    && error.issues.some((issue) => issue.path[0] === 'timezone')) {
    return 'The selected time zone is invalid.';
  }
  return error instanceof TypeError ? error.message : fallback;
}

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
  getServiceRegistry: () => Promise<ServiceRegistry>;
  now?: () => number;
};

type PendingProposal = { proposal: CreationProposal; offeredServiceIds: ReadonlySet<string>; expiresAt: number };
type SavedProposalReceipt = {
  saved: true;
  agent: { id: string; name: string };
  safe_test: { available: true; mode: 'safe_test'; run_endpoint: string };
};
type ProposalSaveSuccess = Omit<SavedProposalReceipt, 'agent'> & {
  agent: AgentConfig;
  security_analysis?: SecurityAnalysis;
  preflight?: PreflightResult;
};
type StaleServiceSaveFailure = {
  error: string;
  saved: false;
  refresh_services: true;
};
type SecuritySaveFailure = {
  error: string;
  saved: false;
  security_analysis: SecurityAnalysis | undefined;
  preflight: PreflightResult;
};
type ProposalSaveOutcome =
  | { status: 201; body: ProposalSaveSuccess }
  | { status: 409; body: StaleServiceSaveFailure }
  | { status: 422; body: SecuritySaveFailure };
const PROPOSAL_TTL_MS = 30 * 60 * 1_000;
const MAX_PENDING_PROPOSALS = 100;
const COMPLETED_SAVE_TTL_MS = 30 * 60 * 1_000;
const MAX_COMPLETED_SAVES = 100;

class ServiceRegistryUnavailableError extends Error {}

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
  const activeSaves = new Map<string, Promise<ProposalSaveOutcome>>();
  const completedSaves = new Map<string, SavedProposalReceipt & { expiresAt: number }>();
  const now = dependencies.now ?? Date.now;

  function remember(proposal: CreationProposal, services: readonly { id: string }[]): string {
    const id = randomUUID();
    pending.set(id, {
      proposal,
      offeredServiceIds: new Set(services.map((service) => service.id)),
      expiresAt: now() + PROPOSAL_TTL_MS,
    });
    while (pending.size > MAX_PENDING_PROPOSALS) {
      const oldest = pending.keys().next().value as string | undefined;
      if (!oldest) break;
      pending.delete(oldest);
    }
    return id;
  }

  function findProposal(id: string): PendingProposal | undefined {
    const entry = pending.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      pending.delete(id);
      return undefined;
    }
    return entry;
  }

  function findCompletedSave(id: string): SavedProposalReceipt | undefined {
    const entry = completedSaves.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      completedSaves.delete(id);
      return undefined;
    }
    const { expiresAt: _, ...receipt } = entry;
    return receipt;
  }

  function rememberCompletedSave(id: string, agent: AgentConfig): void {
    for (const [completedId, entry] of completedSaves) {
      if (entry.expiresAt <= now()) completedSaves.delete(completedId);
    }
    completedSaves.set(id, {
      saved: true,
      agent: { id: agent.id, name: agent.name },
      safe_test: {
        available: true,
        mode: 'safe_test',
        run_endpoint: `/agents/${agent.id}/safe-test`,
      },
      expiresAt: now() + COMPLETED_SAVE_TTL_MS,
    });
    while (completedSaves.size > MAX_COMPLETED_SAVES) {
      const oldest = completedSaves.keys().next().value as string | undefined;
      if (!oldest) break;
      completedSaves.delete(oldest);
    }
  }

  async function currentServiceRegistry(): Promise<ServiceRegistry> {
    try {
      return await dependencies.getServiceRegistry();
    } catch {
      throw new ServiceRegistryUnavailableError('Service discovery failed');
    }
  }

  async function currentConnectedServices(): Promise<ServiceConnection[]> {
    const registry = await currentServiceRegistry();
    return registry.connections.filter((connection) => connection.status === 'connected');
  }

  function currentServiceBindings(
    proposal: CreationProposal,
    pendingProposal: PendingProposal,
    registry: ServiceRegistry,
  ): ProposalServiceBinding[] | undefined {
    const requiredIds = proposal.connections
      .filter((connection) => connection.required)
      .map((connection) => connection.id);
    const connectedIds = new Set(registry.connections
      .filter((connection) => connection.status === 'connected')
      .map((connection) => connection.id));
    const isCurrent = requiredIds.every((id) => (
      pendingProposal.offeredServiceIds.has(id)
      && connectedIds.has(id)
      && registry.bindings.has(id)
    ));
    if (!isCurrent) return undefined;
    const bindings: ProposalServiceBinding[] = [];
    for (const id of requiredIds) {
      const binding = registry.bindings.get(id);
      if (!binding) return undefined;
      bindings.push({ id, ...binding });
    }
    return bindings;
  }

  async function savePendingProposal(
    proposalId: string,
    pendingProposal: PendingProposal,
  ): Promise<ProposalSaveOutcome> {
    const reviewed = CreationProposalSchema.parse(pendingProposal.proposal);
    const registry = await currentServiceRegistry();
    const serviceBindings = currentServiceBindings(reviewed, pendingProposal, registry);
    if (!serviceBindings) {
      return {
        status: 409,
        body: {
          error: 'A selected service is no longer ready. Refresh services and review the proposal again.',
          saved: false,
          refresh_services: true,
        },
      };
    }
    const agent = proposalToAgentConfig(reviewed, deriveProposalAgentId(reviewed.name), { serviceBindings });
    const candidateContent = renderReviewedAgentFile(agent);
    const analysis = dependencies.security
      ? await dependencies.security.analyze({ agent, content: candidateContent })
      : undefined;
    const check = dependencies.security
      ? await dependencies.security.preflight({ agent, content: candidateContent })
      : undefined;
    if (check?.decision === 'block') {
      return {
        status: 422,
        body: {
          error: 'Review the critical security findings before saving this agent.',
          saved: false,
          security_analysis: analysis,
          preflight: check,
        },
      };
    }

    const created = await dependencies.writer.createReviewed(agent);
    const safeTest = {
      available: true as const,
      mode: 'safe_test' as const,
      run_endpoint: `/agents/${created.agent.id}/safe-test`,
    };
    const body: ProposalSaveSuccess = {
      saved: true,
      agent: redactAgentSecrets(created.agent),
      safe_test: safeTest,
      ...(analysis ? { security_analysis: analysis, preflight: check } : {}),
    };
    pending.delete(proposalId);
    rememberCompletedSave(proposalId, created.agent);
    return { status: 201, body };
  }

  function proposalServiceInputs(services: readonly ServiceConnection[]) {
    return services.map((service) => ({
      id: service.id,
      service_id: service.service_id,
      name: service.name,
      source: service.source,
      actions: service.actions,
      actions_known: service.actions_known,
    }));
  }

  app.post('/guidance/agent-proposals', async (context) => {
    try {
      const request = ProposalApiRequestSchema.parse(await readJson(context.req.raw));
      const authoritativeServices = await currentConnectedServices();
      const connectedServices = proposalServiceInputs(authoritativeServices);
      const proposalRequest = {
        request: request.request,
        timezone: request.timezone,
        connectedServices,
        availableCalendars: request.available_calendars.map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
          account: calendar.account,
          canModify: calendar.can_modify,
        })),
        availableReminderLists: request.available_reminder_lists.map((list) => ({
          id: list.id,
          name: list.name,
          account: list.account,
          canModify: list.can_modify,
        })),
        availableContactGroups: request.available_contact_groups,
        answers: request.answers,
      };
      const result = await createAgentProposal({
        ...proposalRequest,
        model: dependencies.model,
      });
      if (result.status !== 'proposal') return context.json(result);
      return context.json({
        ...result,
        proposal_id: remember(result.proposal, servicesRelevantToRequest(proposalRequest)),
      });
    } catch (error) {
      if (error instanceof ProposalGenerationUnavailableError) {
        return context.json({ error: error.message, saved: false, retryable: true }, 503);
      }
      if (error instanceof ServiceRegistryUnavailableError) {
        return context.json({
          error: 'Apps and services could not be checked. Nothing was saved.',
          saved: false,
          retryable: true,
        }, 503);
      }
      return context.json({
        error: proposalRequestErrorMessage(error, 'The agent request is invalid.'),
        saved: false,
      }, 400);
    }
  });

  app.post('/guidance/agents/:agentId/similar-proposals', async (context) => {
    try {
      const request = ProposalApiRequestSchema.parse(await readJson(context.req.raw));
      const authoritativeServices = await currentConnectedServices();
      const connectedServices = proposalServiceInputs(authoritativeServices);
      const source = (await dependencies.getAgents())
        .find((agent) => agent.id === context.req.param('agentId'));
      if (!source) {
        return context.json({ error: 'The agent to copy could not be found.', saved: false }, 404);
      }
      const proposalRequest = {
        request: buildSimilarAgentRequest(source, request.request),
        timezone: request.timezone,
        connectedServices,
        availableCalendars: request.available_calendars.map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
          account: calendar.account,
          canModify: calendar.can_modify,
        })),
        availableReminderLists: request.available_reminder_lists.map((list) => ({
          id: list.id,
          name: list.name,
          account: list.account,
          canModify: list.can_modify,
        })),
        availableContactGroups: request.available_contact_groups,
        answers: request.answers,
      };
      const result = await createAgentProposal({
        ...proposalRequest,
        model: dependencies.model,
      });
      if (result.status !== 'proposal') return context.json(result);
      return context.json({
        ...result,
        proposal_id: remember(result.proposal, servicesRelevantToRequest(proposalRequest)),
      });
    } catch (error) {
      if (error instanceof ProposalGenerationUnavailableError) {
        return context.json({ error: error.message, saved: false, retryable: true }, 503);
      }
      if (error instanceof ServiceRegistryUnavailableError) {
        return context.json({
          error: 'Apps and services could not be checked. Nothing was saved.',
          saved: false,
          retryable: true,
        }, 503);
      }
      return context.json({
        error: proposalRequestErrorMessage(error, 'The similar agent request is invalid.'),
        saved: false,
      }, 400);
    }
  });

  app.post('/guidance/agent-proposals/:proposalId/save', async (context) => {
    try {
      SaveProposalRequestSchema.parse(await readJson(context.req.raw));
      const proposalId = context.req.param('proposalId');
      const completed = findCompletedSave(proposalId);
      if (completed) return context.json(completed, 201);

      let save = activeSaves.get(proposalId);
      if (!save) {
        const pendingProposal = findProposal(proposalId);
        if (!pendingProposal) {
          return context.json({ error: 'This proposal is no longer available for review.', saved: false }, 404);
        }
        save = savePendingProposal(proposalId, pendingProposal);
        activeSaves.set(proposalId, save);
      }
      try {
        const outcome = await save;
        if (outcome.status === 201) return context.json(outcome.body, 201);
        if (outcome.status === 409) return context.json(outcome.body, 409);
        return context.json(outcome.body, 422);
      } finally {
        if (activeSaves.get(proposalId) === save) activeSaves.delete(proposalId);
      }
    } catch (error) {
      if (error instanceof ServiceRegistryUnavailableError) {
        return context.json({
          error: 'Apps and services could not be checked. Nothing was saved.',
          saved: false,
          retryable: true,
        }, 503);
      }
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
