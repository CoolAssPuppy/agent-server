import { readFileSync } from 'fs';
import { z } from 'zod';

const PackageMetadataSchema = z.object({
  version: z.string().min(1),
});

const packageMetadata = PackageMetadataSchema.parse(
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
);

export const AGENT_SERVER_VERSION = packageMetadata.version;
