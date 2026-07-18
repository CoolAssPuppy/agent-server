import { z } from 'zod';
import type { AgentConfig } from '../agents/config.js';
import type { LocalStructuredModel } from '../creation/local-structured-model.js';
import { hasEffectiveNetworkAccess } from '../execution/permission-policy.js';
import {
  PreflightResultSchema,
  RiskSummarySchema,
  SecurityAnalysisSchema,
  SecurityReviewStateSchema,
  type Finding,
  type PreflightResult,
  type RiskSeverity,
  type SecurityAnalysis,
  type SecurityReviewState,
} from './models.js';
import { type SqliteSecurityReviewStore } from './review-store.js';
import { analyzeAgentSecurity, computeAgentContentHash } from './security-rules.js';
import { runSemanticSecurityAnalysis } from './semantic-security.js';

export const ANALYZER_VERSION = '1.1.0';

export type SecurityAnalysisInput = { agent: AgentConfig; content: string };

export type SecurityScanResult = {
  analyses: Array<SecurityAnalysis & { review_state: SecurityReviewState }>;
  summary: {
    total_agents: number;
    by_risk: Record<RiskSeverity, number>;
    stale_reviews: number;
  };
};

const MarkReviewedSchema = z.object({
  agent_id: z.string().trim().min(1).max(160),
  content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  acknowledged_finding_ids: z.array(z.string().trim().min(1).max(200)).max(500),
}).strict();

export class SecurityAnalysisService {
  private readonly analysisCache = new Map<string, Promise<SecurityAnalysis>>();

  constructor(private readonly dependencies: {
    reviewStore: SqliteSecurityReviewStore;
    homeDir: string;
    now?: () => Date;
    model?: LocalStructuredModel;
  }) {}

  analyze(input: SecurityAnalysisInput): Promise<SecurityAnalysis> {
    const cacheKey = `${ANALYZER_VERSION}:${input.agent.id}:${computeAgentContentHash(input.content)}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached) return cached;
    const analysis = this.performAnalysis(input);
    this.analysisCache.set(cacheKey, analysis);
    if (this.analysisCache.size > 100) {
      const oldest = this.analysisCache.keys().next().value;
      if (oldest) this.analysisCache.delete(oldest);
    }
    void analysis.then(
      (result) => {
        if ((result.model_status === 'unavailable' || result.model_status === 'timed_out')
          && this.analysisCache.get(cacheKey) === analysis) {
          this.analysisCache.delete(cacheKey);
        }
      },
      () => {
        if (this.analysisCache.get(cacheKey) === analysis) this.analysisCache.delete(cacheKey);
      },
    );
    return analysis;
  }

  private async performAnalysis(input: SecurityAnalysisInput): Promise<SecurityAnalysis> {
    const result = analyzeAgentSecurity({
      agent: input.agent,
      rawContent: input.content,
      homeDir: this.dependencies.homeDir,
    });
    const semantic = this.dependencies.model
      ? await runSemanticSecurityAnalysis({ agent: input.agent, model: this.dependencies.model })
      : { status: 'unavailable' as const, findings: [] };
    const findings = mergeFindings(result.findings, semantic.findings);
    const risk = summarizeRisk(findings);
    const now = (this.dependencies.now ?? (() => new Date()))();
    const analysis = SecurityAnalysisSchema.parse({
      schema_version: 1,
      agent_id: input.agent.id,
      content_hash: result.contentHash,
      analyzer_version: ANALYZER_VERSION,
      analyzed_at: now.toISOString(),
      risk,
      findings,
      is_stale: false,
      model_status: semantic.status,
    });
    this.dependencies.reviewStore.recordAnalysis({
      agentId: input.agent.id,
      contentHash: analysis.content_hash,
      analyzerVersion: ANALYZER_VERSION,
      findingIds: analysis.findings.map((finding) => finding.id),
      analyzedAt: now,
    });
    return analysis;
  }

  async preflight(input: SecurityAnalysisInput): Promise<PreflightResult> {
    const analysis = await this.analyze(input);
    const review = this.dependencies.reviewStore.get(analysis.agent_id);
    const isCurrentReview = review?.reviewedAt !== undefined
      && review.contentHash === analysis.content_hash
      && review.analyzerVersion === ANALYZER_VERSION;
    const acknowledged = isCurrentReview && analysis.findings.every(
      (finding) => review.acknowledgedFindingIds.includes(finding.id),
    );
    const destructiveExternalAction = hasEffectiveNetworkAccess(input.agent)
      && analysis.findings.some((finding) => finding.rule_id === 'prompt.destructive_or_exfiltration');
    const decision = preflightDecision(analysis.risk.level, acknowledged, destructiveExternalAction);
    return PreflightResultSchema.parse({
      schema_version: 1,
      agent_id: analysis.agent_id,
      content_hash: analysis.content_hash,
      analyzer_version: ANALYZER_VERSION,
      decision,
      risk: analysis.risk,
      findings: analysis.findings,
      acknowledgement_required: decision !== 'allow',
    });
  }

  async scan(inputs: SecurityAnalysisInput[]): Promise<SecurityScanResult> {
    const rawAnalyses: SecurityAnalysis[] = [];
    if (this.dependencies.model) {
      for (let index = 0; index < inputs.length; index += 2) {
        rawAnalyses.push(...await Promise.all(inputs.slice(index, index + 2).map((input) => this.analyze(input))));
      }
    } else {
      rawAnalyses.push(...await Promise.all(inputs.map((input) => this.analyze(input))));
    }
    const analyses = rawAnalyses.map((analysis) => ({
      ...analysis,
      review_state: this.getReviewState(analysis.agent_id, analysis.content_hash),
    }));
    const byRisk: Record<RiskSeverity, number> = { low: 0, needs_review: 0, high: 0, critical: 0 };
    for (const analysis of analyses) byRisk[analysis.risk.level] += 1;
    return {
      analyses,
      summary: {
        total_agents: analyses.length,
        by_risk: byRisk,
        stale_reviews: analyses.filter((analysis) => (
          analysis.review_state.is_stale || !analysis.review_state.is_reviewed
        )).length,
      },
    };
  }

  reviewState(agentId: string, content: string): { is_stale: boolean; reviewed_at?: string } {
    const hash = content.startsWith('sha256:') ? content : computeAgentContentHash(content);
    const state = this.getReviewState(agentId, hash);
    return {
      is_stale: state.is_stale,
      ...(state.reviewed_at ? { reviewed_at: state.reviewed_at } : {}),
    };
  }

  getReviewState(agentId: string, contentHash: string): SecurityReviewState {
    const record = this.dependencies.reviewStore.get(agentId);
    const isStale = !record
      || record.contentHash !== contentHash
      || record.analyzerVersion !== ANALYZER_VERSION;
    return SecurityReviewStateSchema.parse({
      reviewed_at: record?.reviewedAt?.toISOString() ?? null,
      is_reviewed: !isStale && record?.reviewedAt !== undefined,
      is_stale: isStale,
      acknowledged_finding_ids: record?.acknowledgedFindingIds ?? [],
      analyzer_version: ANALYZER_VERSION,
      content_hash: contentHash,
    });
  }

  markReviewed(input: z.input<typeof MarkReviewedSchema>): boolean {
    const value = MarkReviewedSchema.parse(input);
    const current = this.dependencies.reviewStore.get(value.agent_id);
    const matchesCurrentAnalysis = current?.contentHash === value.content_hash
      && current.analyzerVersion === ANALYZER_VERSION;
    const acknowledgesKnownFindings = value.acknowledged_finding_ids.every(
      (findingId) => current?.findingIds.includes(findingId),
    );
    if (!matchesCurrentAnalysis || !acknowledgesKnownFindings) return false;
    return this.dependencies.reviewStore.markReviewed({
      agentId: value.agent_id,
      contentHash: value.content_hash,
      analyzerVersion: ANALYZER_VERSION,
      acknowledgedFindingIds: value.acknowledged_finding_ids,
      reviewedAt: (this.dependencies.now ?? (() => new Date()))(),
    });
  }
}

const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  low: 0,
  needs_review: 1,
  high: 2,
  critical: 3,
};

function mergeFindings(deterministic: Finding[], semantic: Finding[]): Finding[] {
  const findings = new Map(deterministic.map((finding) => [finding.id, finding]));
  for (const finding of semantic) {
    if (!findings.has(finding.id) && findings.size < 200) findings.set(finding.id, finding);
  }
  return [...findings.values()];
}

function summarizeRisk(findings: Finding[]) {
  const level = findings.reduce<RiskSeverity>((highest, finding) => (
    SEVERITY_ORDER[finding.severity] > SEVERITY_ORDER[highest] ? finding.severity : highest
  ), 'low');
  return RiskSummarySchema.parse({
    level,
    reasons: findings
      .filter((finding) => finding.severity === level)
      .slice(0, 12)
      .map((finding) => finding.title),
    finding_count: findings.length,
  });
}

function preflightDecision(
  risk: RiskSeverity,
  isAcknowledged: boolean,
  hasDestructiveExternalAction: boolean,
): 'allow' | 'confirm' | 'block' {
  if (risk === 'critical' || hasDestructiveExternalAction) return 'block';
  if (risk === 'high' && !isAcknowledged) return 'confirm';
  return 'allow';
}
