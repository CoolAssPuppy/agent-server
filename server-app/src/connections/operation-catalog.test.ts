import { describe, expect, it } from 'vitest';
import { resolveAdapterOperation } from './operation-catalog.js';

describe('portable operation catalog', () => {
  it('keeps trusted target rules when a stored review is present', () => {
    expect(resolveAdapterOperation('notion.rest-mcp', 'notion.page.read', {
      runtime_name: 'API-retrieve-page-markdown',
      effect: 'read',
      target: { argument: 'page_id', resource_type: 'notion.page' },
    })).toEqual({
      tool: 'API-retrieve-page-markdown',
      targetField: 'page_id',
      targetType: 'notion.page',
      effect: 'read',
    });
  });

  it('maps EventKit calendar reads to the selected local calendar', () => {
    expect(resolveAdapterOperation('eventkit.mcp', 'calendar.event.list')).toEqual({
      tool: 'list_events',
      targetField: 'calendarId',
      targetType: 'calendar.calendar',
      targetRequired: true,
      effect: 'read',
    });
  });

  it('maps enforceable EventKit calendar writes without exposing concrete tool names', () => {
    expect(resolveAdapterOperation('eventkit.mcp', 'calendar.event.create')).toEqual({
      tool: 'create_event',
      targetField: 'calendarId',
      targetType: 'calendar.calendar',
      targetRequired: true,
      effect: 'write',
    });
    expect(() => resolveAdapterOperation('eventkit.mcp', 'calendar.event.update'))
      .toThrow('does not support operation "calendar.event.update"');
  });
});
