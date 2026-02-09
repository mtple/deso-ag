import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'websocket-polyfill';
import { fetchNostr } from '../src/fetchers/nostr.js';
import type { SearchOptions } from '../src/types.js';

describe('fetchNostr', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  const baseOptions: SearchOptions = {
    sources: ['nostr'],
    timeframe: '24h',
    limit: 5,
  };

  it('returns source as nostr', async () => {
    // Mock trending API to return empty
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    const result = await fetchNostr(baseOptions);

    expect(result.source).toBe('nostr');
  });

  it('uses nostr.wine trending API when no query', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    await fetchNostr(baseOptions);

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const url = calls[0][0] as string;
    expect(url).toContain('api.nostr.wine/trending');
  });

  it('returns empty posts on trending API failure gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const result = await fetchNostr(baseOptions);

    expect(result.source).toBe('nostr');
    expect(result.error).toBeDefined();
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await fetchNostr(baseOptions);

    expect(result.posts).toEqual([]);
    expect(result.error).toContain('Network error');
  });

  it('returns posts array (possibly empty)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    });

    const result = await fetchNostr(baseOptions);

    expect(result.posts).toBeInstanceOf(Array);
  });
});
