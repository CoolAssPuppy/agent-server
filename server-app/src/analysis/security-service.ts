import { z } from 'zod';
import type { AgentConfig } from '../agents/config.js';
import { SecurityAnalysisSchema, type RiskSeverity, type SecurityAnalysis } from './models.js';
import { type SqliteSecurityReviewStore } from './review-store.js';
import { analyzeAgentSecurity, computeAgentContentHash } from './security-rules.js';

export const ANALYZER_VERSION = '1.0.0';

export type SecurityAnalysisInput = { agent: AgentConfig; content: string };

export type SecurityScanResult = {
  analyses: SecurityAnalysis[];
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
  constructor(private readonly dependencies: {
    reviewStore: SqliteSecurityReviewStore;
    homeDir: string;
    now?: () => Date;
  }) {}

  async analyze(input: SecurityAnalysisInput): Promise<SecurityAnalysis> {
    const result = analyzeAgentSecurity({
      agent: input.agent,
      rawContent: input.content,
      homeDir: this.dependencies.homeDir,
    });
    const now = (this.dependencies.now ?? (() => new Date()))();
    const analysis = SecurityAnalysisSchema.parse({
      schema_version: 1,
      agent_id: input.agent.id,
      content_hash: result.contentHash,
      analyzer_version: ANALYZER_VERSION,
      analyzed_at: now.toISOString(),
      risk: result.risk,
      findings: result.findings,
      is_stale: false,
      model_status: 'not_needed',
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

  async scan(inputs: SecurityAnalysisInput[]): Promise<SecurityScanResult> {
    const analyses = await Promise.all(inputs.map((input) => this.analyze(input)));
    const byRisk: Record<RiskSeverity, number> = { low: 0, needs_review: 0, high: 0, critical: 0 };
    for (const analysis of analyses) byRisk[analysis.risk.level] += 1;
    return {
      analyses,
      summary: {
        total_agents: analyses.length,
        by_risk: byRisk,
        stale_reviews: analyses.filter((analysis) => {
          const review = this.dependencies.reviewStore.get(analysis.agent_id);
          return !review?.reviewedAt
            || review.contentHash !== analysis.content_hash
            || review.analyzerVersion !== ANALYZER_VERSION;
        }).length,
      },
    };
  }

  reviewState(agentId: string, content: string): { is_stale: boolean; reviewed_at?: string } {
    const hash = content.startsWith('sha256:') ? content : computeAgentContentHash(content);
    const record = this.dependencies.reviewStore.get(agentId);
    return {
      is_stale: this.dependencies.reviewStore.isStale(agentId, hash, ANALYZER_VERSION),
      ...(record?.reviewedAt ? { reviewed_at: record.reviewedAt.toISOString() } : {}),
    };
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
