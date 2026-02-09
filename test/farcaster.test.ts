import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFarcaster } from '../src/fetchers/farcaster.js';
import type { SearchOptions } from '../src/types.js';

function makeNeynarCast(overrides: Record<string, unknown> = {}) {
  return {
    hash: (overrides.hash as string) ?? '0xabc123def456',
    author: (overrides.author as Record<string, unknown>) ?? {
      fid: 12345,
      username: 'alice',
      display_name: 'Alice',
    },
    text: (overrides.text as string) ?? 'Hello from Farcaster about ethereum',
    timestamp: (overrides.timestamp as string) ?? new Date().toISOString(),
    reactions: (overrides.reactions as Record<string, number>) ?? {
      likes_count: 10,
      recasts_count: 5,
    },
    replies: (overrides.replies as Record<string, number>) ?? {
      count: 3,
    },
  };
}

describe('fetchFarcaster', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
    process.env.NEYNAR_API_KEY = 'test-neynar-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  function mockFetch(data: unknown, ok = true, status = 200) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(data),
    });
  }

  const baseOptions: SearchOptions = {
    sources: ['farcaster'],
    timeframe: '24h',
    limit: 5,
  };

  it('returns error when NEYNAR_API_KEY is missing', async () => {
    delete process.env.NEYNAR_API_KEY;

    const result = await fetchFarcaster(baseOptions);

    expect(result.posts).toEqual([]);
    expect(result.source).toBe('farcaster');
    expect(result.error).toContain('NEYNAR_API_KEY');
  });

  it('sends API key in x-api-key header for trending', async () => {
    mockFetch({ casts: [] });

    await fetchFarcaster(baseOptions);

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const headers = calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-neynar-key');
  });

  it('uses trending endpoint when no query provided', async () => {
    mockFetch({ casts: [], next: undefined });

    await fetchFarcaster(baseOptions);

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const url = calls[0][0] as string;
    expect(url).toContain('/feed/trending');
  });

  it('uses search endpoint when query provided', async () => {
    mockFetch({ result: { casts: [] } });

    await fetchFarcaster({ ...baseOptions, query: 'ethereum' });

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const url = calls[0][0] as string;
    expect(url).toContain('/cast/search');
    expect(url).toContain('q=ethereum');
  });

  it('maps Neynar cast to Post shape', async () => {
    const cast = makeNeynarCast();
    mockFetch({ result: { casts: [cast] } });

    const result = await fetchFarcaster({ ...baseOptions, query: 'ethereum' });

    expect(result.posts).toHaveLength(1);
    const post = result.posts[0];
    expect(post.source).toBe('farcaster');
    expect(post.author.username).toBe('alice');
    expect(post.author.displayName).toBe('Alice');
    expect(post.content).toBe('Hello from Farcaster about ethereum');
    expect(post.engagement?.likes).toBe(10);
    expect(post.engagement?.reposts).toBe(5);
    expect(post.engagement?.replies).toBe(3);
  });

  it('filters posts outside timeframe cutoff', async () => {
    const recent = makeNeynarCast({
      hash: '0xrecent',
      text: 'recent ethereum post',
      timestamp: '2025-06-15T10:00:00Z',
    });
    const old = makeNeynarCast({
      hash: '0xold',
      text: 'old ethereum post',
      timestamp: '2025-06-13T10:00:00Z',
    });
    mockFetch({ result: { casts: [recent, old] } });

    const result = await fetchFarcaster({ ...baseOptions, query: 'ethereum', timeframe: '24h' });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].id).toBe('0xrecent');
  });

  it('filters empty content', async () => {
    const empty = makeNeynarCast({ hash: '0xempty', text: '   ' });
    const real = makeNeynarCast({ hash: '0xreal', text: 'real ethereum content here' });
    mockFetch({ result: { casts: [empty, real] } });

    const result = await fetchFarcaster({ ...baseOptions, query: 'ethereum' });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].content).toBe('real ethereum content here');
  });

  it('returns error on API failure', async () => {
    mockFetch({}, false, 500);

    const result = await fetchFarcaster({ ...baseOptions, query: 'test' });

    expect(result.posts).toEqual([]);
    expect(result.error).toContain('Farcaster');
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await fetchFarcaster({ ...baseOptions, query: 'test' });

    expect(result.posts).toEqual([]);
    expect(result.error).toContain('Network error');
  });
});
