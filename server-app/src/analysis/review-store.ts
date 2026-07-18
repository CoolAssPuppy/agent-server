import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { z } from 'zod';

const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IdentifierListSchema = z.array(z.string().trim().min(1).max(200)).max(500);

const AnalysisRecordInputSchema = z.object({
  agentId: z.string().trim().min(1).max(160),
  contentHash: ContentHashSchema,
  analyzerVersion: z.string().trim().min(1).max(40),
  findingIds: IdentifierListSchema,
  analyzedAt: z.date(),
}).strict();

const ReviewInputSchema = z.object({
  agentId: z.string().trim().min(1).max(160),
  contentHash: ContentHashSchema,
  analyzerVersion: z.string().trim().min(1).max(40),
  acknowledgedFindingIds: IdentifierListSchema,
  reviewedAt: z.date(),
}).strict();

export type AnalysisRecordInput = z.infer<typeof AnalysisRecordInputSchema>;
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

export type SecurityReviewRecord = {
  agentId: string;
  contentHash: string;
  analyzerVersion: string;
  findingIds: string[];
  analyzedAt: Date;
  reviewedAt?: Date;
  acknowledgedFindingIds: string[];
};

type ReviewRow = {
  agent_id: string;
  content_hash: string;
  analyzer_version: string;
  finding_ids: string;
  analyzed_at: number;
  reviewed_at: number | null;
  acknowledged_finding_ids: string;
};

export class SqliteSecurityReviewStore {
  private readonly db: DatabaseSync;

  constructor(options: { path: string }) {
    if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true });
    this.db = new DatabaseSync(options.path);
    if (options.path !== ':memory:') chmodSync(options.path, 0o600);
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.migrate();
  }

  recordAnalysis(input: AnalysisRecordInput): void {
    const value = AnalysisRecordInputSchema.parse(input);
    const existing = this.get(value.agentId);
    const canKeepReview = existing?.contentHash === value.contentHash
      && existing.analyzerVersion === value.analyzerVersion;

    this.db.prepare(`
      INSERT OR REPLACE INTO security_reviews (
        agent_id, content_hash, analyzer_version, finding_ids, analyzed_at,
        reviewed_at, acknowledged_finding_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.agentId,
      value.contentHash,
      value.analyzerVersion,
      JSON.stringify(unique(value.findingIds)),
      value.analyzedAt.getTime(),
      canKeepReview && existing?.reviewedAt ? existing.reviewedAt.getTime() : null,
      JSON.stringify(canKeepReview ? existing?.acknowledgedFindingIds ?? [] : []),
    );
  }

  markReviewed(input: ReviewInput): boolean {
    const value = ReviewInputSchema.parse(input);
    const result = this.db.prepare(`
      UPDATE security_reviews
      SET reviewed_at = ?, acknowledged_finding_ids = ?
      WHERE agent_id = ? AND content_hash = ? AND analyzer_version = ?
    `).run(
      value.reviewedAt.getTime(),
      JSON.stringify(unique(value.acknowledgedFindingIds)),
      value.agentId,
      value.contentHash,
      value.analyzerVersion,
    );
    return Number(result.changes) > 0;
  }

  get(agentId: string): SecurityReviewRecord | undefined {
    const row = this.db.prepare('SELECT * FROM security_reviews WHERE agent_id = ?')
      .get(agentId) as ReviewRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  list(): SecurityReviewRecord[] {
    const rows = this.db.prepare('SELECT * FROM security_reviews ORDER BY analyzed_at DESC')
      .all() as ReviewRow[];
    return rows.map(rowToRecord);
  }

  isStale(agentId: string, contentHash: string, analyzerVersion: string): boolean {
    const record = this.get(agentId);
    return !record
      || record.contentHash !== contentHash
      || record.analyzerVersion !== analyzerVersion;
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_reviews (
        agent_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        analyzer_version TEXT NOT NULL,
        finding_ids TEXT NOT NULL DEFAULT '[]',
        analyzed_at INTEGER NOT NULL,
        reviewed_at INTEGER,
        acknowledged_finding_ids TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_security_reviews_analyzed
        ON security_reviews (analyzed_at DESC);
    `);
  }
}

function parseIdentifiers(value: string): string[] {
  try {
    const result = IdentifierListSchema.safeParse(JSON.parse(value));
    return result.success ? unique(result.data) : [];
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function rowToRecord(row: ReviewRow): SecurityReviewRecord {
  return {
    agentId: row.agent_id,
    contentHash: row.content_hash,
    analyzerVersion: row.analyzer_version,
    findingIds: parseIdentifiers(row.finding_ids),
    analyzedAt: new Date(row.analyzed_at),
    reviewedAt: row.reviewed_at === null ? undefined : new Date(row.reviewed_at),
    acknowledgedFindingIds: parseIdentifiers(row.acknowledged_finding_ids),
  };
}
