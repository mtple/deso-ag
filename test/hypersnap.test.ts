import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchHypersnap, DEFAULT_HYPERSNAP_NODE } from '../src/fetchers/hypersnap.js';
import type { SearchOptions } from '../src/types.js';

function makeHypersnapCast(overrides: Record<string, unknown> = {}) {
  return {
    object: 'cast',
    hash: (overrides.hash as string) ?? '0xabc123def456',
    author: (overrides.author as Record<string, unknown>) ?? {
      object: 'user',
      fid: 12345,
      username: 'alice',
      display_name: 'Alice',
    },
    text: (overrides.text as string) ?? 'Hello from Hypersnap about ethereum',
    timestamp: (overrides.timestamp as string) ?? '2025-06-15T11:00:00Z',
    reactions: (overrides.reactions as Record<string, number>) ?? {
      likes_count: 10,
      recasts_count: 5,
    },
    replies: (overrides.replies as Record<string, number>) ?? {
      count: 3,
    },
    channel: overrides.channel,
  };
}

/** What /cast/search returns: bare hex hash, no counts. */
function makeSearchHit(overrides: Record<string, unknown> = {}) {
  return {
    ...makeHypersnapCast(overrides),
    hash: (overrides.hash as string) ?? 'abc123def456',
    reactions: { likes_count: 0, recasts_count: 0 },
    replies: { count: 0 },
  };
}

function response(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
  };
}

describe('fetchHypersnap', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
    delete process.env.HYPERSNAP_NODE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  function mockFetch(...responses: unknown[]) {
    const fn = vi.fn();
    for (const r of responses) fn.mockResolvedValueOnce(r);
    fn.mockResolvedValue(response({ casts: [] }));
    globalThis.fetch = fn;
    return fn;
  }

  function calledUrls(): string[] {
    return vi.mocked(globalThis.fetch).mock.calls.map(c => c[0] as string);
  }

  const baseOptions: SearchOptions = {
    sources: ['hypersnap'],
    timeframe: '24h',
    limit: 5,
  };

  describe('node and auth', () => {
    it('needs no API key', async () => {
      delete process.env.NEYNAR_API_KEY;
      mockFetch(response({ casts: [makeHypersnapCast()] }));

      const result = await fetchHypersnap(baseOptions);

      expect(result.error).toBeUndefined();
      expect(result.posts).toHaveLength(1);
      const headers = vi.mocked(globalThis.fetch).mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBeUndefined();
    });

    it('uses the public node by default', async () => {
      mockFetch(response({ casts: [] }));

      await fetchHypersnap(baseOptions);

      expect(calledUrls()[0].startsWith(`${DEFAULT_HYPERSNAP_NODE}/v2/farcaster/`)).toBe(true);
    });

    it('uses HYPERSNAP_NODE_URL when set, ignoring a trailing slash', async () => {
      process.env.HYPERSNAP_NODE_URL = 'http://localhost:3381/';
      mockFetch(response({ casts: [] }));

      await fetchHypersnap(baseOptions);

      expect(calledUrls()[0].startsWith('http://localhost:3381/v2/farcaster/feed/trending?')).toBe(true);
    });
  });

  describe('trending', () => {
    it('uses the trending feed when there is no query or channel', async () => {
      mockFetch(response({ casts: [] }));

      await fetchHypersnap(baseOptions);

      const url = calledUrls()[0];
      expect(url).toContain('/v2/farcaster/feed/trending?');
      expect(url).toContain('time_window=24h');
      expect(url).toContain('limit=5');
    });

    it('maps week to the 7d window', async () => {
      mockFetch(response({ casts: [] }));

      await fetchHypersnap({ ...baseOptions, timeframe: 'week' });

      expect(calledUrls()[0]).toContain('time_window=7d');
    });

    it('reads the 7d window in full pages for 48h and cuts it to 48h', async () => {
      const inside = makeHypersnapCast({ hash: '0xinside', timestamp: '2025-06-14T00:00:00Z' });
      const outside = makeHypersnapCast({ hash: '0xoutside', timestamp: '2025-06-12T00:00:00Z' });
      mockFetch(response({ casts: [inside, outside] }));

      const result = await fetchHypersnap({ ...baseOptions, timeframe: '48h' });

      const url = calledUrls()[0];
      expect(url).toContain('time_window=7d');
      expect(url).toContain('limit=100');
      expect(result.posts.map(p => p.id)).toEqual(['0xinside']);
    });

    it('paginates with the cursor until it has enough posts', async () => {
      const fetchFn = mockFetch(
        response({ casts: [makeHypersnapCast({ hash: '0x01' }), makeHypersnapCast({ hash: '0x02' })], next: { cursor: 'page2' } }),
        response({ casts: [makeHypersnapCast({ hash: '0x03' }), makeHypersnapCast({ hash: '0x04' })], next: { cursor: 'page3' } }),
      );

      const result = await fetchHypersnap({ ...baseOptions, limit: 3, timeframe: '48h' });

      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(calledUrls()[1]).toContain('cursor=page2');
      expect(result.posts.map(p => p.id)).toEqual(['0x01', '0x02', '0x03']);
    });

    it('stops when the feed has no next cursor', async () => {
      const fetchFn = mockFetch(response({ casts: [makeHypersnapCast()], next: { cursor: null } }));

      await fetchHypersnap({ ...baseOptions, limit: 10 });

      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('post mapping', () => {
    it('maps a cast to the Post shape with Quilcast links', async () => {
      mockFetch(response({ casts: [makeHypersnapCast({ channel: { id: 'dev' } })] }));

      const result = await fetchHypersnap(baseOptions);

      const post = result.posts[0];
      expect(post.source).toBe('hypersnap');
      expect(post.id).toBe('0xabc123def456');
      expect(post.author.username).toBe('alice');
      expect(post.author.displayName).toBe('Alice');
      expect(post.author.profileUrl).toBe('https://quilcast.com/u/alice');
      expect(post.url).toBe('https://quilcast.com/c/0xabc123def456');
      expect(post.content).toBe('Hello from Hypersnap about ethereum');
      expect(post.timestamp).toEqual(new Date('2025-06-15T11:00:00Z'));
      expect(post.engagement).toEqual({ likes: 10, reposts: 5, replies: 3 });
      expect(post.channel).toBe('dev');
    });

    it('falls back to the FID when there is no username, including string FIDs', async () => {
      mockFetch(response({
        casts: [makeHypersnapCast({ author: { fid: '18446744073709551000', username: '' } })],
      }));

      const result = await fetchHypersnap(baseOptions);

      expect(result.posts[0].author.username).toBe('fid:18446744073709551000');
      expect(result.posts[0].author.profileUrl).toBe('https://quilcast.com/u/18446744073709551000');
    });

    it('drops posts outside the timeframe and empty posts', async () => {
      mockFetch(response({
        casts: [
          makeHypersnapCast({ hash: '0xrecent', timestamp: '2025-06-15T10:00:00Z' }),
          makeHypersnapCast({ hash: '0xold', timestamp: '2025-06-13T10:00:00Z' }),
          makeHypersnapCast({ hash: '0xempty', text: '   ' }),
        ],
      }));

      const result = await fetchHypersnap(baseOptions);

      expect(result.posts.map(p => p.id)).toEqual(['0xrecent']);
    });
  });

  describe('search', () => {
    it('searches newest-first and encodes spaces as %20', async () => {
      mockFetch(response({ result: { casts: [] } }));

      await fetchHypersnap({ ...baseOptions, query: 'AI crypto' });

      const url = calledUrls()[0];
      expect(url).toContain('/v2/farcaster/cast/search?');
      expect(url).toContain('q=AI%20crypto');
      expect(url).not.toContain('+');
      expect(url).toContain('sort_type=desc_chronological');
    });

    it('fills in engagement for search hits from cast/bulk', async () => {
      mockFetch(
        response({ result: { casts: [makeSearchHit({ hash: 'aaa111' }), makeSearchHit({ hash: 'bbb222' })] } }),
        response({
          casts: [
            makeHypersnapCast({ hash: '0xaaa111', reactions: { likes_count: 40, recasts_count: 2 }, replies: { count: 7 } }),
            makeHypersnapCast({ hash: '0xbbb222', reactions: { likes_count: 1, recasts_count: 0 }, replies: { count: 0 } }),
          ],
        }),
      );

      const result = await fetchHypersnap({ ...baseOptions, query: 'ethereum' });

      const bulkUrl = calledUrls()[1];
      expect(bulkUrl).toContain('/v2/farcaster/cast/bulk?hashes=');
      expect(decodeURIComponent(bulkUrl)).toContain('hashes=0xaaa111,0xbbb222');
      expect(result.posts.map(p => [p.id, p.engagement?.likes, p.engagement?.replies])).toEqual([
        ['0xaaa111', 40, 7],
        ['0xbbb222', 1, 0],
      ]);
    });

    it('keeps search hits with zero engagement when cast/bulk fails', async () => {
      mockFetch(
        response({ result: { casts: [makeSearchHit({ hash: 'aaa111' })] } }),
        response({ message: 'Hub query service not available' }, false, 503),
      );

      const result = await fetchHypersnap({ ...baseOptions, query: 'ethereum' });

      expect(result.error).toBeUndefined();
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].id).toBe('0xaaa111');
      expect(result.posts[0].engagement?.likes).toBe(0);
    });

    it('applies AND semantics to multi-word queries', async () => {
      mockFetch(
        response({
          result: {
            casts: [
              makeSearchHit({ hash: 'both', text: 'AI meets crypto' }),
              makeSearchHit({ hash: 'one', text: 'just AI today' }),
            ],
          },
        }),
        response({ casts: [] }),
      );

      const result = await fetchHypersnap({ ...baseOptions, query: 'AI crypto' });

      expect(result.posts.map(p => p.id)).toEqual(['0xboth']);
    });
  });

  describe('channels', () => {
    it('reads the channel feed for --channel', async () => {
      mockFetch(response({ casts: [makeHypersnapCast()] }));

      const result = await fetchHypersnap({ ...baseOptions, channel: 'dev' });

      const url = calledUrls()[0];
      expect(url).toContain('/v2/farcaster/feed/channels?');
      expect(url).toContain('channel_ids=dev');
      expect(result.posts).toHaveLength(1);
    });

    it('matches a query against the channel feed locally', async () => {
      mockFetch(response({
        casts: [
          makeHypersnapCast({ hash: '0xmatch', text: 'shipping a rust node' }),
          makeHypersnapCast({ hash: '0xmiss', text: 'gm' }),
        ],
      }));

      const result = await fetchHypersnap({ ...baseOptions, channel: 'dev', query: 'rust' });

      const url = calledUrls()[0];
      expect(url).toContain('/feed/channels?');
      expect(url).not.toContain('/cast/search');
      expect(url).toContain('limit=100');
      expect(result.posts.map(p => p.id)).toEqual(['0xmatch']);
    });

    it('stops paging a channel once a whole page is older than the cutoff', async () => {
      const fetchFn = mockFetch(
        response({ casts: [makeHypersnapCast({ timestamp: '2025-06-10T00:00:00Z' })], next: { cursor: 'more' } }),
      );

      const result = await fetchHypersnap({ ...baseOptions, channel: 'dev' });

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.posts).toEqual([]);
    });
  });

  describe('errors', () => {
    it('reports the status and node message on API failure', async () => {
      mockFetch(response({ message: 'Feeds feature disabled' }, false, 503));

      const result = await fetchHypersnap(baseOptions);

      expect(result.posts).toEqual([]);
      expect(result.source).toBe('hypersnap');
      expect(result.error).toContain('Hypersnap trending API: 503');
      expect(result.error).toContain('Feeds feature disabled');
    });

    it('reports network failures', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await fetchHypersnap({ ...baseOptions, query: 'test' });

      expect(result.posts).toEqual([]);
      expect(result.error).toContain('Network error');
    });

    it('reports a timeout in plain words', async () => {
      const abort = new Error('This operation was aborted');
      abort.name = 'AbortError';
      globalThis.fetch = vi.fn().mockRejectedValue(abort);

      const result = await fetchHypersnap(baseOptions);

      expect(result.error).toContain('no response from https://haatz.quilibrium.com');
    });
  });
});
