import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBluesky } from '../src/fetchers/bluesky.js';
import type { SearchOptions } from '../src/types.js';

function makeBskyPost(overrides: Record<string, unknown> = {}) {
  return {
    uri: (overrides.uri as string) ?? 'at://did:plc:abc123/app.bsky.feed.post/rkey1',
    cid: 'bafyrei123',
    author: (overrides.author as Record<string, unknown>) ?? {
      did: 'did:plc:abc123',
      handle: 'alice.bsky.social',
      displayName: 'Alice',
    },
    record: (overrides.record as Record<string, unknown>) ?? {
      text: 'Hello from Bluesky about ethereum',
      createdAt: new Date().toISOString(),
      tags: ['ethereum'],
    },
    likeCount: (overrides.likeCount as number) ?? 10,
    replyCount: (overrides.replyCount as number) ?? 2,
    repostCount: (overrides.repostCount as number) ?? 3,
    quoteCount: (overrides.quoteCount as number) ?? 1,
  };
}

const SESSION_RESPONSE = { accessJwt: 'test-jwt-token', did: 'did:plc:test' };

describe('fetchBluesky', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
    process.env.BLUESKY_IDENTIFIER = 'test.bsky.social';
    process.env.BLUESKY_APP_PASSWORD = 'test-app-password';
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

  /**
   * Mock fetch for the search flow (createSession + searchPosts).
   */
  function mockSearchFlow(searchData: unknown, searchOk = true, searchStatus = 200) {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('createSession')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(SESSION_RESPONSE),
        });
      }
      return Promise.resolve({
        ok: searchOk,
        status: searchStatus,
        json: () => Promise.resolve(searchData),
      });
    });
  }

  const baseOptions: SearchOptions = {
    sources: ['bluesky'],
    timeframe: '24h',
    limit: 5,
  };

  describe('trending (no query)', () => {
    it('uses public getFeed endpoint without auth', async () => {
      mockFetch({ feed: [] });

      await fetchBluesky(baseOptions);

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect(calls).toHaveLength(1);
      const url = calls[0][0] as string;
      expect(url).toContain('public.api.bsky.app');
      expect(url).toContain('getFeed');
      expect(url).toContain('whats-hot');
      // No Authorization header
      const headers = calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('works without credentials set', async () => {
      delete process.env.BLUESKY_IDENTIFIER;
      delete process.env.BLUESKY_APP_PASSWORD;
      mockFetch({ feed: [] });

      const result = await fetchBluesky(baseOptions);

      expect(result.error).toBeUndefined();
      expect(result.posts).toEqual([]);
    });

    it('maps feed posts to Post shape', async () => {
      const bskyPost = makeBskyPost();
      mockFetch({ feed: [{ post: bskyPost }] });

      const result = await fetchBluesky(baseOptions);

      expect(result.posts).toHaveLength(1);
      const post = result.posts[0];
      expect(post.source).toBe('bluesky');
      expect(post.author.username).toBe('alice.bsky.social');
      expect(post.author.displayName).toBe('Alice');
      expect(post.content).toBe('Hello from Bluesky about ethereum');
      expect(post.url).toBe('https://bsky.app/profile/alice.bsky.social/post/rkey1');
      expect(post.engagement?.likes).toBe(10);
      expect(post.engagement?.reposts).toBe(4); // repostCount(3) + quoteCount(1)
      expect(post.engagement?.replies).toBe(2);
      expect(post.tags).toEqual(['ethereum']);
    });

    it('returns error on feed API failure', async () => {
      mockFetch({}, false, 500);

      const result = await fetchBluesky(baseOptions);

      expect(result.posts).toEqual([]);
      expect(result.error).toContain('Bluesky');
      expect(result.error).toContain('500');
    });
  });

  describe('search (with query)', () => {
    it('returns error when credentials are missing', async () => {
      delete process.env.BLUESKY_IDENTIFIER;
      delete process.env.BLUESKY_APP_PASSWORD;

      const result = await fetchBluesky({ ...baseOptions, query: 'ethereum' });

      expect(result.posts).toEqual([]);
      expect(result.source).toBe('bluesky');
      expect(result.error).toContain('BLUESKY_IDENTIFIER');
      expect(result.error).toContain('BLUESKY_APP_PASSWORD');
    });

    it('authenticates then searches', async () => {
      mockSearchFlow({ posts: [] });

      await fetchBluesky({ ...baseOptions, query: 'ethereum' });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toContain('createSession');
      expect(calls[0][1]?.method).toBe('POST');
      expect(calls[1][0]).toContain('searchPosts');
      const headers = calls[1][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-jwt-token');
    });

    it('sends query and sort=top', async () => {
      mockSearchFlow({ posts: [] });

      await fetchBluesky({ ...baseOptions, query: 'ethereum' });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const searchUrl = new URL(calls[1][0] as string);
      expect(searchUrl.searchParams.get('q')).toBe('ethereum');
      expect(searchUrl.searchParams.get('sort')).toBe('top');
    });

    it('does not send since parameter', async () => {
      mockSearchFlow({ posts: [] });

      await fetchBluesky({ ...baseOptions, query: 'test' });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const searchUrl = new URL(calls[1][0] as string);
      expect(searchUrl.searchParams.get('since')).toBeNull();
    });

    it('maps search posts to Post shape', async () => {
      const bskyPost = makeBskyPost();
      mockSearchFlow({ posts: [bskyPost] });

      const result = await fetchBluesky({ ...baseOptions, query: 'ethereum' });

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].source).toBe('bluesky');
      expect(result.posts[0].content).toBe('Hello from Bluesky about ethereum');
    });

    it('returns error on auth failure', async () => {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('createSession')) {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ error: 'AuthenticationRequired' }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ posts: [] }) });
      });

      const result = await fetchBluesky({ ...baseOptions, query: 'test' });

      expect(result.posts).toEqual([]);
      expect(result.error).toContain('auth failed');
    });

    it('returns error on search API failure', async () => {
      mockSearchFlow({}, false, 403);

      const result = await fetchBluesky({ ...baseOptions, query: 'test' });

      expect(result.posts).toEqual([]);
      expect(result.error).toContain('Bluesky');
      expect(result.error).toContain('403');
    });

    it('caps limit at 100', async () => {
      mockSearchFlow({ posts: [] });

      await fetchBluesky({ ...baseOptions, query: 'test', limit: 200 });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const searchUrl = new URL(calls[1][0] as string);
      expect(searchUrl.searchParams.get('limit')).toBe('100');
    });

    it('uses api.bsky.app for search', async () => {
      mockSearchFlow({ posts: [] });

      await fetchBluesky({ ...baseOptions, query: 'test' });

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const searchUrl = new URL(calls[1][0] as string);
      expect(searchUrl.origin).toBe('https://api.bsky.app');
      expect(searchUrl.pathname).toBe('/xrpc/app.bsky.feed.searchPosts');
    });
  });

  describe('common behavior', () => {
    it('filters posts outside timeframe cutoff', async () => {
      const recent = makeBskyPost({
        uri: 'at://did:plc:abc/app.bsky.feed.post/recent',
        record: { text: 'recent post', createdAt: '2025-06-15T10:00:00Z' },
      });
      const old = makeBskyPost({
        uri: 'at://did:plc:abc/app.bsky.feed.post/old',
        record: { text: 'old post', createdAt: '2025-06-13T10:00:00Z' },
      });
      mockFetch({ feed: [{ post: recent }, { post: old }] });

      const result = await fetchBluesky({ ...baseOptions, timeframe: '24h' });

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].id).toContain('recent');
    });

    it('filters empty content', async () => {
      const empty = makeBskyPost({
        uri: 'at://did:plc:abc/app.bsky.feed.post/empty',
        record: { text: '   ', createdAt: new Date().toISOString() },
      });
      const real = makeBskyPost({
        uri: 'at://did:plc:abc/app.bsky.feed.post/real',
        record: { text: 'real content here', createdAt: new Date().toISOString() },
      });
      mockFetch({ feed: [{ post: empty }, { post: real }] });

      const result = await fetchBluesky(baseOptions);

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].content).toBe('real content here');
    });

    it('returns error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await fetchBluesky(baseOptions);

      expect(result.posts).toEqual([]);
      expect(result.error).toContain('Network error');
    });
  });
});
