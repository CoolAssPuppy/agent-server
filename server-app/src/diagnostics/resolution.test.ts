import { describe, expect, it } from 'vitest';
import { makeAgent, makeStoredRun } from '../test-factories.js';
import { analyzeRunFailure } from './diagnostic-service.js';
import { buildDiagnosticResolution } from './resolution.js';

const content = `---
id: reports
name: Reports
tools: [Read]
file_access:
  - path: /Users/example/Documents/Reports
    kind: folder
    access: read_only
---
Save a report in the selected folder.
`;

describe('diagnostic fix resolution', () => {
  it('upgrades only the reviewed file grant that contains the failed write', async () => {
    const agent = makeAgent({
      id: 'reports',
      tools: ['Read'],
      file_access: [{
        path: '/Users/example/Documents/Reports', kind: 'folder', access: 'read_only',
      }],
    });
    const diagnosis = await analyzeRunFailure({
      agent,
      run: makeStoredRun({
        agentId: 'reports',
        status: 'failed',
        error: 'write denied in read-only folder',
        filesWritten: ['/Users/example/Documents/Reports/today.md'],
      }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
    });

    const resolution = buildDiagnosticResolution(diagnosis, agent, content);

    expect(resolution.type).toBe('configuration_patch');
    if (resolution.type !== 'configuration_patch') throw new Error('Expected a reviewed patch');
    expect(resolution.patch.changes.file_access).toEqual([{
      path: '/Users/example/Documents/Reports', kind: 'folder', access: 'read_write',
    }]);
  });

  it('does not grant generic write access when no reviewed location contains the failed write', async () => {
    const agent = makeAgent({ id: 'reports', tools: ['Read'], file_access: undefined });
    const diagnosis = await analyzeRunFailure({
      agent,
      run: makeStoredRun({
        agentId: 'reports',
        status: 'failed',
        error: 'write denied in read-only folder',
        filesWritten: ['/Users/example/Documents/Reports/today.md'],
      }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
    });

    const resolution = buildDiagnosticResolution(diagnosis, agent, content);

    expect(resolution).toMatchObject({
      type: 'manual',
      limitation: 'Choose the exact file or folder before allowing changes.',
    });
  });

  it('does not treat a friendly placeholder as a failed file path', async () => {
    const agent = makeAgent({
      id: 'reports',
      tools: ['Read'],
      working_directory: '/Users/example/Documents/Reports',
      file_access: [{
        path: '/Users/example/Documents/Reports', kind: 'folder', access: 'read_only',
      }],
    });
    const diagnosis = await analyzeRunFailure({
      agent,
      run: makeStoredRun({
        agentId: 'reports',
        status: 'failed',
        error: 'save denied by read-only access',
        filesWritten: [],
      }),
      readiness: { serverOnline: true, runtimeAvailable: true, workingDirectoryExists: true },
    });

    expect(buildDiagnosticResolution(diagnosis, agent, content)).toMatchObject({
      type: 'manual',
      limitation: 'Choose the exact file or folder before allowing changes.',
    });
  });
});
