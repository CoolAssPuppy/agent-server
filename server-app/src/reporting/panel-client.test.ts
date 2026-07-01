import { describe, it, expect, vi } from 'vitest';
import { PanelClient, createPanelClient } from './panel-client.js';

function createMockFetch(response: { ok: boolean; status: number; body?: unknown } = { ok: true, status: 200, body: { ok: true, cleaned: 3 } }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: async () => response.body,
  });
}

describe('PanelClient', () => {
  describe('failOrphanedRuns', () => {
    it('sends POST to cleanup endpoint with worker_id', async () => {
      const mockFetch = createMockFetch();
      const client = new PanelClient({
        panelUrl: 'https://panel.example.com',
        panelApiKey: 'test-key',
        fetch: mockFetch,
      });

      const result = await client.failOrphanedRuns('myhost-1234');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://panel.example.com/api/runs/cleanup');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer test-key');
      expect(JSON.parse(options.body)).toEqual({ worker_id: 'myhost-1234' });
      expect(result).toBe(3);
    });

    it('sends POST without worker_id when not provided', async () => {
      const mockFetch = createMockFetch();
      const client = new PanelClient({
        panelUrl: 'https://panel.example.com',
        panelApiKey: 'test-key',
        fetch: mockFetch,
      });

      await client.failOrphanedRuns();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({});
    });

    it('returns 0 when request fails', async () => {
      const mockFetch = createMockFetch({ ok: false, status: 500 });
      const client = new PanelClient({
        panelUrl: 'https://panel.example.com',
        panelApiKey: 'test-key',
        fetch: mockFetch,
      });

      const result = await client.failOrphanedRuns('myhost-1234');
      expect(result).toBe(0);
    });

    it('returns 0 when fetch throws', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const client = new PanelClient({
        panelUrl: 'https://panel.example.com',
        panelApiKey: 'test-key',
        fetch: mockFetch,
      });

      const result = await client.failOrphanedRuns('myhost-1234');
      expect(result).toBe(0);
    });
  });

});

describe('createPanelClient', () => {
  it('returns null when panelUrl is not configured', () => {
    const client = createPanelClient({});
    expect(client).toBeNull();
  });

  it('returns null when panelApiKey is not configured', () => {
    const client = createPanelClient({ panelUrl: 'https://panel.example.com' });
    expect(client).toBeNull();
  });

  it('returns a PanelClient when both are configured', () => {
    const client = createPanelClient({
      panelUrl: 'https://panel.example.com',
      panelApiKey: 'test-key',
    });
    expect(client).toBeInstanceOf(PanelClient);
  });
});
