import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLens } from '../src/fetchers/lens.js';
import type { SearchOptions } from '../src/types.js';

function makeLensPost(overrides: Record<string, unknown> = {}) {
  return {
    slug: (overrides.slug as string) ?? 'post-slug-123',
    timestamp: (overrides.timestamp as string) ?? new Date().toISOString(),
    author: (overrides.author as Record<string, unknown>) ?? {
      username: { value: 'lens/alice', localName: 'alice' },
      metadata: { name: 'Alice' },
    },
    metadata: (overrides.metadata as Record<string, unknown>) ?? {
      content: 'Hello from Lens about ethereum',
    },
    stats: (overrides.stats as Record<string, number>) ?? {
      reactions: 10,
      reposts: 5,
      comments: 3,
    },
  };
}

function makeLensResponse(posts: unknown[]) {
  return {
    data: {
      posts: {
        items: posts,
      },
    },
  };
}

describe('fetchLens', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  function mockFetch(data: unknown, ok = true, status = 200) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(data),
    });
  }

  const baseOptions: SearchOptions = {
    sources: ['lens'],
    timeframe: '24h',
    limit: 5,
  };

  it('uses GraphQL POST to Lens API', async () => {
    mockFetch(makeLensResponse([]));

    await fetchLens(baseOptions);

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls).toHaveLength(1);
    const url = calls[0][0] as string;
    expect(url).toContain('api.lens.xyz/graphql');
    expect(calls[0][1]?.method).toBe('POST');
  });

  it('includes searchQuery when query provided', async () => {
    mockFetch(makeLensResponse([]));

    await fetchLens({ ...baseOptions, query: 'ethereum' });

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const body = JSON.parse(calls[0][1]?.body as string);
    expect(body.variables.searchQuery).toBe('ethereum');
    expect(body.query).toContain('searchQuery');
  });

  it('omits searchQuery when no query provided', async () => {
    mockFetch(makeLensResponse([]));

    await fetchLens(baseOptions);

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const body = JSON.parse(calls[0][1]?.body as string);
    expect(body.variables.searchQuery).toBeUndefined();
  });

  it('maps Lens post to Post shape', async () => {
    const post = makeLensPost();
    mockFetch(makeLensResponse([post]));

    const result = await fetchLens(baseOptions);

    expect(result.posts).toHaveLength(1);
    const mapped = result.posts[0];
    expect(mapped.source).toBe('lens');
    expect(mapped.author.username).toBe('alice');
    expect(mapped.author.displayName).toBe('Alice');
    expect(mapped.content).toBe('Hello from Lens about ethereum');
    expect(mapped.url).toContain('hey.xyz/posts/post-slug-123');
    expect(mapped.engagement?.likes).toBe(10);
    expect(mapped.engagement?.reposts).toBe(5);
    expect(mapped.engagement?.replies).toBe(3);
  });

  it('filters posts outside timeframe cutoff', async () => {
    const recent = makeLensPost({
      slug: 'recent',
      timestamp: '2025-06-15T10:00:00Z',
    });
    const old = makeLensPost({
      slug: 'old',
      timestamp: '2025-06-13T10:00:00Z',
      metadata: { content: 'old post content' },
    });
    mockFetch(makeLensResponse([recent, old]));

    const result = await fetchLens({ ...baseOptions, timeframe: '24h' });

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].id).toBe('recent');
  });

  it('filters empty content', async () => {
    const empty = makeLensPost({
      slug: 'empty',
      metadata: { content: '   ' },
    });
    const real = makeLensPost({
      slug: 'real',
      metadata: { content: 'real content here' },
    });
    mockFetch(makeLensResponse([empty, real]));

    const result = await fetchLens(baseOptions);

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].content).toBe('real content here');
  });

  it('returns error on API failure', async () => {
    mockFetch({}, false, 500);

    const result = await fetchLens(baseOptions);

    expect(result.posts).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it('returns error on GraphQL error', async () => {
    mockFetch({
      errors: [{ message: 'Something went wrong' }],
    });

    const result = await fetchLens(baseOptions);

    expect(result.posts).toEqual([]);
    expect(result.error).toContain('Something went wrong');
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await fetchLens(baseOptions);

    expect(result.posts).toEqual([]);
    expect(result.error).toContain('Network error');
  });
});
