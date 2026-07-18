import { describe, expect, it } from 'vitest';
import { AgentConfigSchema } from './config.js';
import { makeAgent } from '../test-factories.js';
import { nativeServiceGrantEnvironment } from './native-services.js';

describe('native Mac service grants', () => {
  it('parses independent Reminder list actions', () => {
    const agent = AgentConfigSchema.parse(makeAgent({
      native_services: {
        reminders: {
          resources: [{ id: 'personal-list', name: 'Personal', actions: ['read', 'create', 'complete'] }],
        },
      },
    }));

    expect(agent.native_services?.reminders?.resources[0]).toEqual({
      id: 'personal-list', name: 'Personal', actions: ['read', 'create', 'complete'],
    });
  });

  it('rejects duplicate resources, duplicate actions, and unsupported Reminder actions', () => {
    const duplicateResources = AgentConfigSchema.safeParse(makeAgent({
      native_services: {
        reminders: {
          resources: [
            { id: 'list-1', name: 'One', actions: ['read'] },
            { id: 'list-1', name: 'Duplicate', actions: ['create'] },
          ],
        },
      },
    }));
    const duplicateActions = AgentConfigSchema.safeParse(makeAgent({
      native_services: {
        reminders: { resources: [{ id: 'list-1', name: 'One', actions: ['read', 'read'] }] },
      },
    }));
    const unsupported = AgentConfigSchema.safeParse(makeAgent({
      native_services: {
        reminders: { resources: [{ id: 'list-1', name: 'One', actions: ['delete'] }] },
      },
    }));

    expect(duplicateResources.success).toBe(false);
    expect(duplicateActions.success).toBe(false);
    expect(unsupported.success).toBe(false);
  });

  it('keeps explicit deny-all distinct from legacy absence', () => {
    expect(AgentConfigSchema.parse(makeAgent({ native_services: {} })).native_services).toEqual({});
    expect(AgentConfigSchema.parse(makeAgent()).native_services).toBeUndefined();
  });

  it('rejects ambiguous Calendar grant formats and explicit EventKit overrides', () => {
    const bothFormats = AgentConfigSchema.safeParse(makeAgent({
      calendar_access: [{ id: 'calendar-1', name: 'Work', access: 'read_only' }],
      native_services: {
        calendar: { resources: [{ id: 'calendar-1', name: 'Work', actions: ['read'] }] },
      },
    }));
    const helperOverride = AgentConfigSchema.safeParse(makeAgent({
      native_services: { reminders: { resources: [{ id: 'list-1', name: 'One', actions: ['read'] }] } },
      mcp_servers: { eventkit: { command: '/tmp/unverified-eventkit' } },
    }));
    const legacyHelperOverride = AgentConfigSchema.safeParse(makeAgent({
      calendar_access: [{ id: 'calendar-1', name: 'Work', access: 'read_only' }],
      mcp_servers: { eventkit: { command: '/tmp/unverified-eventkit' } },
    }));

    expect(bothFormats.success).toBe(false);
    expect(helperOverride.success).toBe(false);
    expect(legacyHelperOverride.success).toBe(false);
  });

  it('serializes explicit grants and maps legacy Calendar access without delete', () => {
    const reminders = AgentConfigSchema.parse(makeAgent({
      native_services: {
        reminders: { resources: [{ id: 'list-1', name: 'Personal', actions: ['read', 'complete'] }] },
      },
    }));
    const legacyCalendar = AgentConfigSchema.parse(makeAgent({
      calendar_access: [{ id: 'calendar-1', name: 'Work', access: 'read_write' }],
    }));

    expect(JSON.parse(nativeServiceGrantEnvironment(reminders) ?? '')).toEqual({
      version: 1,
      services: reminders.native_services,
    });
    expect(JSON.parse(nativeServiceGrantEnvironment(legacyCalendar) ?? '')).toEqual({
      version: 1,
      services: {
        calendar: {
          resources: [{ id: 'calendar-1', name: 'Work', actions: ['read', 'create', 'update'] }],
        },
      },
    });
    expect(nativeServiceGrantEnvironment(AgentConfigSchema.parse(makeAgent()))).toBeUndefined();
  });

  it('combines legacy Calendar access with scoped Reminder access', () => {
    const agent = AgentConfigSchema.parse(makeAgent({
      calendar_access: [{ id: 'calendar-1', name: 'Work', access: 'read_only' }],
      native_services: {
        reminders: { resources: [{ id: 'list-1', name: 'Personal', actions: ['read'] }] },
      },
    }));

    expect(JSON.parse(nativeServiceGrantEnvironment(agent) ?? '')).toEqual({
      version: 1,
      services: {
        calendar: { resources: [{ id: 'calendar-1', name: 'Work', actions: ['read'] }] },
        reminders: { resources: [{ id: 'list-1', name: 'Personal', actions: ['read'] }] },
      },
    });
  });
});
