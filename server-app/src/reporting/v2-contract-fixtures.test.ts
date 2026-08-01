import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { makeAgent, makeStoredRun } from '../test-factories.js';
import { V2CommandRequestSchema } from '../execution/v2-command.js';
import { DecisionResolutionSchema } from '../interaction/decision-resolution.js';
import { createRunReview } from '../presentation/run-review.js';
import { buildV2AssistantSyncPayload } from './v2-assistant-sync.js';
import { serializeV2OperationalStatus } from './v2-status.js';

const fixturesDir = join(import.meta.dirname, '../../../docs/v2/fixtures');
const machineId = '1d2f8f5e-9ea8-4fce-89b1-1c7c2f5ecf99';

function readFixture(filename: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, filename), 'utf8')) as unknown;
}

describe('V2 cross-repository fixtures', () => {
  it('keeps the operational status fixture equal to Server serialization', () => {
    expect(serializeV2OperationalStatus({
      machineId,
      processId: 'office-mac-1234',
      localAgentId: 'weekly-report',
      runId: 'e566a8f5-becf-49e7-a384-a72d42e9f807',
      state: 'completed',
      timestamp: '2026-08-01T09:00:00.000Z',
    })).toEqual(readFixture('status-operational-completed.json'));
  });

  it('keeps the operational assistant sync fixture equal to Server serialization', () => {
    expect(buildV2AssistantSyncPayload([
      {
        agent: makeAgent({
          id: 'weekly-report',
          name: 'Weekly Report',
          enabled: true,
          schedule: undefined,
          timezone: undefined,
        }),
        content: 'id: weekly-report\nname: Weekly Report\nprompt: Create report.\n',
      },
      {
        agent: makeAgent({
          id: 'paused-assistant',
          name: 'Paused Assistant',
          enabled: false,
          schedule: undefined,
          timezone: undefined,
        }),
        content: 'id: paused-assistant\nenabled: false\n',
      },
    ], {
      machineId,
      now: new Date('2026-08-01T09:00:00.000Z'),
    })).toEqual(readFixture('assistant-sync-operational.json'));
  });

  it('keeps the targeted command fixture valid at the local command boundary', () => {
    expect(V2CommandRequestSchema.parse(readFixture('command-targeted-run.json'))).toEqual(
      readFixture('command-targeted-run.json'),
    );
  });

  it('keeps every canonical decision resolution fixture valid', () => {
    const fixtures = readFixture('decision-resolutions.json');
    expect(Array.isArray(fixtures)).toBe(true);
    if (!Array.isArray(fixtures)) return;

    expect(fixtures.map((fixture) => DecisionResolutionSchema.parse(fixture))).toEqual(fixtures);
  });

  it('keeps the completed run review fixture equal to local presentation', () => {
    expect(createRunReview({
      run: makeStoredRun({
        runId: 'e566a8f5-becf-49e7-a384-a72d42e9f807',
        agentId: 'weekly-report',
        agentName: 'Weekly Report',
        status: 'completed',
        summary: 'Published the weekly update.',
        startedAt: new Date('2026-08-01T09:00:00.000Z'),
        completedAt: new Date('2026-08-01T09:02:00.000Z'),
        filesRead: ['/Users/person/Documents/notes.md'],
        filesWritten: ['/Users/person/Documents/weekly-update.md'],
        toolsUsed: ['mcp__notion__create_page'],
      }),
      requiredOutput: { label: 'Weekly update' },
    })).toEqual(readFixture('run-review-completed.json'));
  });
});
