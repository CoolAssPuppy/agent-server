import type { McpServerConfig } from '../agents/config.js';
import type { ConnectionProfile, CredentialReference } from './profile.js';

export type ResolvedConnectionProfile = {
  serverName: string;
  config: McpServerConfig;
};

function credentialById(
  credentials: CredentialReference[],
  id: string,
): CredentialReference {
  const credential = credentials.find((candidate) => candidate.id === id);
  if (!credential) throw new Error(`Connection credential ${id} is unavailable`);
  return credential;
}

function reference(credentials: CredentialReference[], id: string): string {
  return `\${${credentialById(credentials, id).environment_variable}}`;
}

export function resolveConnectionProfile(profile: ConnectionProfile): ResolvedConnectionProfile {
  const { transport, credentials } = profile;
  if (transport.kind === 'mcp_stdio') {
    return {
      serverName: profile.runtime_name,
      config: {
        command: transport.command,
        args: transport.args,
        env: Object.fromEntries(Object.entries(transport.environment).map(([name, id]) => (
          [name, reference(credentials, id)]
        ))),
      },
    };
  }
  if (transport.kind === 'runtime_account') {
    throw new Error(`${profile.label} is supplied by ${transport.executor}, not an injected MCP transport.`);
  }
  return {
    serverName: profile.runtime_name,
    config: {
      type: transport.kind === 'mcp_http' ? 'http' : 'sse',
      url: transport.url,
      headers: Object.fromEntries(transport.headers.map((header) => (
        [header.name, `${header.prefix}${reference(credentials, header.credential_id)}`]
      ))),
    },
  };
}
