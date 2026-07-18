import { homedir } from 'os';
import { join } from 'path';
import { StructuredPatchService } from './patch.js';
import { FileAgentContentRepository } from './patch-repository.js';
import { SqliteSecurityReviewStore } from './review-store.js';
import { createAnalysisApi } from './security-api.js';
import { SecurityAnalysisService } from './security-service.js';

export function createAnalysisRuntime(options: {
  agentsDir: string;
  reviewDbPath?: string;
  homeDir?: string;
}) {
  const repository = new FileAgentContentRepository(options.agentsDir);
  const reviewStore = new SqliteSecurityReviewStore({
    path: options.reviewDbPath ?? join(options.agentsDir, '..', 'security-reviews.db'),
  });
  const security = new SecurityAnalysisService({
    reviewStore,
    homeDir: options.homeDir ?? homedir(),
  });
  const patches = new StructuredPatchService(repository);
  return {
    api: createAnalysisApi({ security, patches, content: repository }),
    close: (): void => reviewStore.close(),
  };
}
