import { randomUUID } from 'crypto';
import { lstat, readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { AGENT_EXTENSIONS } from '../agents/discovery.js';
import { parseAgentFile, type AgentConfig } from '../agents/config.js';
import {
  type AgentContentRepository,
  PatchConflictError,
} from './patch.js';
import { computeAgentContentHash } from './security-rules.js';

type LocatedContent = { path: string; content: string; agent: AgentConfig };

export class FileAgentContentRepository implements AgentContentRepository {
  constructor(private readonly directory: string) {}

  async read(agentId: string): Promise<string> {
    return (await this.locate(agentId)).content;
  }

  async get(agentId: string): Promise<{ agent: AgentConfig; content: string } | undefined> {
    const located = (await this.scan()).find((item) => item.agent.id === agentId);
    return located ? { agent: located.agent, content: located.content } : undefined;
  }

  async list(): Promise<Array<{ agent: AgentConfig; content: string }>> {
    return (await this.scan()).map(({ agent, content }) => ({ agent, content }));
  }

  async replaceIfHashMatches(agentId: string, expectedHash: string, content: string): Promise<void> {
    const located = await this.locate(agentId);
    if (computeAgentContentHash(located.content) !== expectedHash) {
      throw new PatchConflictError('The agent changed. Review the fix again.');
    }
    const fileStats = await stat(located.path);
    const temporaryPath = `${located.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: fileStats.mode & 0o777,
      });
      const latest = await readFile(located.path, 'utf8');
      if (computeAgentContentHash(latest) !== expectedHash) {
        throw new PatchConflictError('The agent changed. Review the fix again.');
      }
      await rename(temporaryPath, located.path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async locate(agentId: string): Promise<LocatedContent> {
    const located = (await this.scan()).find((item) => item.agent.id === agentId);
    if (located) return located;
    throw new Error(`Agent not found: ${agentId}`);
  }

  private async scan(): Promise<LocatedContent[]> {
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return [];
    }
    const agents: LocatedContent[] = [];
    for (const entry of entries.sort()) {
      if (!AGENT_EXTENSIONS.has(extname(entry))) continue;
      const path = join(this.directory, entry);
      try {
        if (!(await lstat(path)).isFile()) continue;
        const content = await readFile(path, 'utf8');
        agents.push({ path, content, agent: parseAgentFile(content) });
      } catch {
        continue;
      }
    }
    return agents;
  }
}
