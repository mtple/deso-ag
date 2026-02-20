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
      json: () => Promise.resolve({ notes: [] }),
    });

    const result = await fetchNostr(baseOptions);

    expect(result.source).toBe('nostr');
  });

  it('tries nostr.band trending API first when no query', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ notes: [] }),
    });

    await fetchNostr(baseOptions);

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const url = calls[0][0] as string;
    expect(url).toContain('api.nostr.band/v0/trending/notes');
  });

  it('falls back to nostr.wine when nostr.band fails', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if ((url as string).includes('nostr.band')) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      // nostr.wine fallback
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    });

    const result = await fetchNostr(baseOptions);

    expect(result.source).toBe('nostr');
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('returns gracefully when all trending APIs fail', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const result = await fetchNostr(baseOptions);

    expect(result.source).toBe('nostr');
    // Should still return (possibly empty), not crash
    expect(result.posts).toBeInstanceOf(Array);
  });

  it('returns gracefully on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await fetchNostr(baseOptions);

    expect(result.posts).toBeInstanceOf(Array);
    expect(result.source).toBe('nostr');
  });

  it('returns posts array (possibly empty)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ notes: [] }),
    });

    const result = await fetchNostr(baseOptions);

    expect(result.posts).toBeInstanceOf(Array);
  });
});
