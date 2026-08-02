import type { AgentConfig } from '../agents/config.js';
import { COMMAND_TOOLS, WRITE_TOOLS, hasAnyPermittedTool } from '../execution/permission-policy.js';
import { matchesPattern } from '../execution/permissions.js';
import type { PermissionStatement } from './assistant-home-models.js';
import { displayPath } from './assistant-presentation-support.js';

function configuredFileStatements(
  agent: AgentConfig,
  canRead: boolean,
  canEdit: boolean,
): PermissionStatement[] {
  if (agent.file_access?.length) {
    return agent.file_access.flatMap((access, index): PermissionStatement[] => {
      const scopeSource = `agent.file_access[${index}]`;
      const canEditPath = access.access === 'read_write' && canEdit;
      return [
        {
          effect: canRead ? 'can' : 'cannot',
          action: 'read',
          targetLabel: displayPath(access.path),
          exactScopeReference: access.path,
          sourceRuleReference: canRead ? scopeSource : deniedToolSource(agent, ['Read', 'Glob', 'Grep']),
        },
        {
          effect: canEditPath ? 'can' : 'cannot',
          action: 'edit',
          targetLabel: displayPath(access.path),
          exactScopeReference: access.path,
          sourceRuleReference: canEditPath || access.access === 'read_only'
            ? scopeSource
            : deniedToolSource(agent, WRITE_TOOLS),
        },
      ];
    });
  }
  if (!agent.working_directory) return [];
  const source = agent.permissions ? 'agent.permissions.allow' : 'agent.tools';
  return [
    ...(canRead ? [{
      effect: 'can' as const,
      action: 'read' as const,
      targetLabel: displayPath(agent.working_directory),
      exactScopeReference: agent.working_directory,
      sourceRuleReference: source,
    }] : []),
    ...(canEdit ? [{
      effect: 'can' as const,
      action: 'edit' as const,
      targetLabel: displayPath(agent.working_directory),
      exactScopeReference: agent.working_directory,
      sourceRuleReference: source,
    }] : []),
  ];
}

function deniedToolSource(agent: AgentConfig, tools: readonly string[]): string {
  if (!agent.permissions) return 'agent.disallowed_tools';
  const hasExplicitDeny = tools.some((tool) => (
    agent.permissions?.deny.some((pattern) => matchesPattern(tool, pattern)) === true
  ));
  return hasExplicitDeny ? 'agent.permissions.deny' : 'agent.permissions.allow';
}

/** Translate only effective file and command rules whose meaning is proven. */
export function createPermissionStatements(agent: AgentConfig): PermissionStatement[] {
  const canRead = hasAnyPermittedTool(agent, ['Read', 'Glob', 'Grep']);
  const canEdit = hasAnyPermittedTool(agent, WRITE_TOOLS);
  const canExecute = hasAnyPermittedTool(agent, COMMAND_TOOLS);
  return [
    ...configuredFileStatements(agent, canRead, canEdit),
    {
      effect: canExecute ? 'can' : 'cannot',
      action: 'execute',
      targetLabel: canExecute ? 'commands' : 'terminal commands',
      exactScopeReference: agent.working_directory ?? '~',
      sourceRuleReference: agent.permissions
        ? (canExecute ? 'agent.permissions.allow' : deniedToolSource(agent, COMMAND_TOOLS))
        : (canExecute ? 'agent.tools' : 'agent.disallowed_tools'),
    },
  ];
}
