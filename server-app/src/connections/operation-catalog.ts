export type AdapterOperation = Readonly<{
  tool: string;
  targetField?: string;
  targetType?: string;
  targetRequired?: boolean;
  effect: 'read' | 'write';
}>;

export type ReviewedOperationBinding = Readonly<{
  runtime_name: string;
  effect: 'read' | 'write';
  target?: Readonly<{
    argument: string;
    resource_type: string;
  }>;
}>;

/** Returns trusted defaults that can be saved after the matching tools are checked. */
export function curatedOperationBindingInputs(
  adapterId: string,
  availableTools: ReadonlyMap<string, { classification: 'curated' | 'unknown'; input_fields?: string[] }>,
): Record<string, ReviewedOperationBinding> {
  const catalog = OPERATIONS_BY_ADAPTER[adapterId] ?? {};
  return Object.fromEntries(Object.entries(catalog).flatMap(([semantic, descriptor]) => {
    const available = availableTools.get(descriptor.tool);
    const targetIsAvailable = !descriptor.targetField
      || available?.input_fields?.includes(descriptor.targetField);
    if (available?.classification !== 'curated' || !targetIsAvailable) return [];
    return [[semantic, {
      runtime_name: descriptor.tool,
      effect: descriptor.effect,
      ...(descriptor.targetField && descriptor.targetType ? {
        target: { argument: descriptor.targetField, resource_type: descriptor.targetType },
      } : {}),
    }]];
  }));
}

const OPERATIONS_BY_ADAPTER: Readonly<Record<string, Readonly<Record<string, AdapterOperation>>>> = {
  'notion.rest-mcp': {
    'notion.search': { tool: 'API-post-search', effect: 'read' },
    'notion.data_source.read': {
      tool: 'API-retrieve-a-data-source', targetField: 'data_source_id',
      targetType: 'notion.data_source', targetRequired: true, effect: 'read',
    },
    'notion.data_source.query': {
      tool: 'API-query-data-source', targetField: 'data_source_id',
      targetType: 'notion.data_source', targetRequired: true, effect: 'read',
    },
    'notion.page.read': {
      tool: 'API-retrieve-page-markdown', targetField: 'page_id',
      targetType: 'notion.page', effect: 'read',
    },
    'notion.page.create': {
      tool: 'API-post-page', targetField: 'parent.database_id',
      targetType: 'notion.data_source', targetRequired: true, effect: 'write',
    },
    'notion.page.update': {
      tool: 'API-patch-page', targetField: 'page_id',
      targetType: 'notion.page', effect: 'write',
    },
  },
  'eventkit.mcp': {
    'calendar.calendar.list': { tool: 'list_calendars', effect: 'read' },
    'calendar.event.list': {
      tool: 'list_events', targetField: 'calendarId',
      targetType: 'calendar.calendar', targetRequired: true, effect: 'read',
    },
    'calendar.event.create': {
      tool: 'create_event', targetField: 'calendarId',
      targetType: 'calendar.calendar', targetRequired: true, effect: 'write',
    },
  },
};

export class UnsupportedConnectionOperationError extends Error {
  constructor(adapterId: string, operation: string) {
    super(`Connection adapter "${adapterId}" does not support operation "${operation}".`);
    this.name = 'UnsupportedConnectionOperationError';
  }
}

/** Maps a portable operation to one adapter's concrete MCP tool name. */
export function resolveAdapterOperation(
  adapterId: string,
  operation: string,
  reviewed?: ReviewedOperationBinding,
): AdapterOperation {
  const curated = OPERATIONS_BY_ADAPTER[adapterId]?.[operation];
  if (curated) return curated;
  if (reviewed) {
    return {
      tool: reviewed.runtime_name,
      effect: reviewed.effect,
      ...(reviewed.target ? {
        targetField: reviewed.target.argument,
        targetType: reviewed.target.resource_type,
        targetRequired: true,
      } : {}),
    };
  }
  throw new UnsupportedConnectionOperationError(adapterId, operation);
}
