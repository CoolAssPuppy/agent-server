import { homedir } from 'os';
import { join } from 'path';
import { StructuredPatchService } from './patch.js';
import { FileAgentContentRepository } from './patch-repository.js';
import { SqliteSecurityReviewStore } from './review-store.js';
import { createAnalysisApi } from './security-api.js';
import { SecurityAnalysisService } from './security-service.js';
import type { LocalStructuredModel } from '../creation/local-structured-model.js';
import type { AgentConfig } from '../agents/config.js';

export function createAnalysisRuntime(options: {
  agentsDir: string;
  reviewDbPath?: string;
  homeDir?: string;
  model?: LocalStructuredModel;
}) {
  const repository = new FileAgentContentRepository(options.agentsDir);
  const reviewStore = new SqliteSecurityReviewStore({
    path: options.reviewDbPath ?? join(options.agentsDir, '..', 'security-reviews.db'),
  });
  const security = new SecurityAnalysisService({
    reviewStore,
    homeDir: options.homeDir ?? homedir(),
    model: options.model,
  });
  const patches = new StructuredPatchService(repository);
  return {
    api: createAnalysisApi({ security, patches, content: repository }),
    security,
    content: repository,
    preflight: async (agent: AgentConfig) => security.preflight({
      agent,
      content: await repository.read(agent.id),
    }),
    close: (): void => reviewStore.close(),
  };
}
