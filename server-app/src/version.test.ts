import { readFileSync } from 'fs';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AGENT_SERVER_VERSION } from './version.js';

describe('Agent Server release version', () => {
  it('uses one version across the server package and macOS app', () => {
    const packageMetadata = z.object({ version: z.string() }).parse(
      JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
    );
    const macOSProject = readFileSync(
      new URL('../../macos-app/project.yml', import.meta.url),
      'utf8',
    );

    expect(packageMetadata.version).toBe(AGENT_SERVER_VERSION);
    expect(macOSProject).toContain(`MARKETING_VERSION: "${AGENT_SERVER_VERSION}"`);
  });
});
