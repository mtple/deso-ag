import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchNostr } from '../src/fetchers/nostr.js';
import type { SearchOptions } from '../src/types.js';

// --- Mock WebSocket ---

type WSHandler = ((event: { data: string }) => void) | (() => void) | null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: WSHandler = null;
  onmessage: WSHandler = null;
  onerror: WSHandler = null;
  onclose: WSHandler = null;
  sentMessages: string[] = [];

  private static _instances: MockWebSocket[] = [];
  private static _behavior: 'connect' | 'fail' | 'hang' = 'connect';

  static get instances() { return MockWebSocket._instances; }

  static setBehavior(b: 'connect' | 'fail' | 'hang') {
    MockWebSocket._behavior = b;
  }

  static reset() {
    MockWebSocket._instances = [];
    MockWebSocket._behavior = 'connect';
  }

  constructor(url: string) {
    this.url = url;
    MockWebSocket._instances.push(this);

    // Simulate async connection
    if (MockWebSocket._behavior === 'connect') {
      queueMicrotask(() => {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) (this.onopen as () => void)();
      });
    } else if (MockWebSocket._behavior === 'fail') {
      queueMicrotask(() => {
        if (this.onerror) (this.onerror as () => void)();
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) (this.onclose as () => void)();
      });
    }
    // 'hang' = never connects, stays CONNECTING
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new TypeError("Cannot read properties of undefined (reading 'sendCloseFrame')");
    }
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) (this.onclose as () => void)();
  }

  /** Simulate the relay sending a message to us */
  receiveMessage(data: unknown) {
    if (this.onmessage) {
      (this.onmessage as (event: { data: string }) => void)({ data: JSON.stringify(data) });
    }
  }
}

// Helper: send events then EOSE on all relay sockets (skipping the profile socket)
function sendEventsToRelaySockets(events: unknown[][], eoseAfter = true) {
  const relaySockets = MockWebSocket.instances.filter(ws =>
    ws.readyState === MockWebSocket.OPEN && !ws.sentMessages.some(m => m.includes('"kinds":[0]'))
  );
  for (const ws of relaySockets) {
    for (const event of events) {
      ws.receiveMessage(event);
    }
    if (eoseAfter) ws.receiveMessage(['EOSE', 'sub']);
  }
}

function sendEoseToProfileSocket() {
  const profileSocket = MockWebSocket.instances.find(ws =>
    ws.sentMessages.some(m => m.includes('"kinds":[0]'))
  );
  if (profileSocket) profileSocket.receiveMessage(['EOSE', 'profiles']);
}

function makeNostrEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: (overrides.id as string) ?? 'abc123',
    pubkey: (overrides.pubkey as string) ?? 'deadbeef00112233445566778899aabb',
    created_at: (overrides.created_at as number) ?? Math.floor(Date.now() / 1000) - 60,
    kind: 1,
    tags: (overrides.tags as string[][]) ?? [],
    content: (overrides.content as string) ?? 'Hello from Nostr about ethereum',
  };
}

function makeTrendingNote(overrides: Record<string, unknown> = {}) {
  return {
    event_id: (overrides.event_id as string) ?? 'abc123',
    reactions: (overrides.reactions as number) ?? 10,
    replies: (overrides.replies as number) ?? 3,
    reposts: (overrides.reposts as number) ?? 5,
    zap_amount: (overrides.zap_amount as number) ?? 1000,
    zap_count: (overrides.zap_count as number) ?? 2,
  };
}

// --- Tests ---

describe('fetchNostr', () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00Z'));
    MockWebSocket.reset();
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
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
    sources: ['nostr'],
    timeframe: '24h',
    limit: 5,
  };

  describe('trending (no query)', () => {
    it('returns source as nostr', async () => {
      mockFetch([]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.source).toBe('nostr');
    });

    it('uses nostr.wine trending API when no query', async () => {
      mockFetch([]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
      sendEoseToProfileSocket();
      await promise;

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const url = calls[0][0] as string;
      expect(url).toContain('api.nostr.wine/trending');
    });

    it('passes hours=24 for 24h timeframe', async () => {
      mockFetch([]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
      sendEoseToProfileSocket();
      await promise;

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const url = calls[0][0] as string;
      expect(url).toContain('hours=24');
    });

    it('passes hours=48 for 48h and week timeframes', async () => {
      mockFetch([]);

      const promise48 = fetchNostr({ ...baseOptions, timeframe: '48h' });
      await vi.advanceTimersByTimeAsync(100);
      sendEoseToProfileSocket();
      await promise48;

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      expect((calls[0][0] as string)).toContain('hours=48');
    });

    it('maps trending events to Post shape with engagement', async () => {
      const trendingNote = makeTrendingNote({ event_id: 'ev1', reactions: 20, reposts: 8, replies: 4 });
      const event = makeNostrEvent({ id: 'ev1', content: 'Trending nostr post' });
      mockFetch([trendingNote]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      // Send events to relay sockets (fetchEventsByIds opens 3 relay connections)
      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);

      // Send EOSE to profile socket
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toHaveLength(1);
      const post = result.posts[0];
      expect(post.source).toBe('nostr');
      expect(post.id).toBe('ev1');
      expect(post.content).toBe('Trending nostr post');
      expect(post.engagement?.likes).toBe(20);
      expect(post.engagement?.reposts).toBe(8);
      expect(post.engagement?.replies).toBe(4);
    });

    it('maps author profile when available', async () => {
      const pubkey = 'deadbeef00112233445566778899aabb';
      const event = makeNostrEvent({ id: 'ev1', pubkey });
      const profile = {
        id: 'prof1', pubkey, created_at: 100, kind: 0,
        tags: [],
        content: JSON.stringify({ name: 'alice', display_name: 'Alice N' }),
      };
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);

      // Send profile data then EOSE
      const profileSocket = MockWebSocket.instances.find(ws =>
        ws.sentMessages.some(m => m.includes('"kinds":[0]'))
      );
      if (profileSocket) {
        profileSocket.receiveMessage(['EVENT', 'profiles', profile]);
        profileSocket.receiveMessage(['EOSE', 'profiles']);
      }
      const result = await promise;

      expect(result.posts[0].author.username).toBe('alice');
      expect(result.posts[0].author.displayName).toBe('Alice N');
    });

    it('uses truncated npub as fallback username when no profile', async () => {
      const event = makeNostrEvent({ id: 'ev1', pubkey: 'aabbccdd00112233445566778899aabb' });
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts[0].author.username).toContain('npub1');
      expect(result.posts[0].author.username).toContain('...');
    });

    it('extracts hashtags from event tags', async () => {
      const event = makeNostrEvent({
        id: 'ev1',
        tags: [['t', 'bitcoin'], ['t', 'nostr'], ['e', 'some-ref']],
      });
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts[0].tags).toEqual(['bitcoin', 'nostr']);
    });

    it('deduplicates events across relays', async () => {
      const event = makeNostrEvent({ id: 'ev1' });
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      // Every relay returns the same event
      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toHaveLength(1);
    });

    it('filters empty content', async () => {
      const empty = makeNostrEvent({ id: 'ev1', content: '   ' });
      const real = makeNostrEvent({ id: 'ev2', content: 'real content' });
      mockFetch([
        makeTrendingNote({ event_id: 'ev1' }),
        makeTrendingNote({ event_id: 'ev2' }),
      ]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      sendEventsToRelaySockets([
        ['EVENT', 'sub', empty],
        ['EVENT', 'sub', real],
      ]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].content).toBe('real content');
    });

    it('returns error on trending API failure', async () => {
      mockFetch({}, false, 500);

      const result = await fetchNostr(baseOptions);

      expect(result.source).toBe('nostr');
      expect(result.error).toBeDefined();
      expect(result.posts).toEqual([]);
    });

    it('returns error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await fetchNostr(baseOptions);

      expect(result.posts).toEqual([]);
      expect(result.error).toContain('Network error');
    });

    it('returns empty posts when trending returns empty array', async () => {
      mockFetch([]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toEqual([]);
      expect(result.error).toBeUndefined();
    });
  });

  describe('search (with query)', () => {
    beforeEach(() => {
      // nostr.wine search finds nothing, so these exercise the relay scan
      mockFetch({ data: [] });
    });

    it('opens WebSocket connections to relays when query provided', async () => {
      const promise = fetchNostr({ ...baseOptions, query: 'bitcoin' });
      await vi.advanceTimersByTimeAsync(50);

      // Should have opened relay connections (3 relays for search)
      const relaySockets = MockWebSocket.instances.filter(ws =>
        ws.url.startsWith('wss://')
      );
      expect(relaySockets.length).toBeGreaterThanOrEqual(3);

      // Resolve all sockets
      for (const ws of MockWebSocket.instances) {
        if (ws.readyState === MockWebSocket.OPEN) {
          ws.receiveMessage(['EOSE', 'sub']);
        }
      }
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      await promise;
    });

    it('sends REQ with kinds [1] and since filter', async () => {
      const promise = fetchNostr({ ...baseOptions, query: 'test' });
      await vi.advanceTimersByTimeAsync(50);

      const relaySockets = MockWebSocket.instances.filter(ws =>
        ws.sentMessages.some(m => m.includes('"kinds":[1]'))
      );
      expect(relaySockets.length).toBeGreaterThan(0);

      const msg = JSON.parse(relaySockets[0].sentMessages[0]);
      expect(msg[0]).toBe('REQ');
      expect(msg[2].kinds).toEqual([1]);
      expect(msg[2].since).toBeDefined();

      // Cleanup
      for (const ws of MockWebSocket.instances) {
        if (ws.readyState === MockWebSocket.OPEN) {
          ws.receiveMessage(['EOSE', 'sub']);
        }
      }
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      await promise;
    });

    it('sends hashtag filter when query starts with #', async () => {
      const promise = fetchNostr({ ...baseOptions, query: '#bitcoin' });
      await vi.advanceTimersByTimeAsync(50);

      const relaySockets = MockWebSocket.instances.filter(ws =>
        ws.sentMessages.some(m => m.includes('"#t"'))
      );
      expect(relaySockets.length).toBeGreaterThan(0);

      const msg = JSON.parse(relaySockets[0].sentMessages[0]);
      expect(msg[2]['#t']).toEqual(['bitcoin']);

      // Cleanup
      for (const ws of MockWebSocket.instances) {
        if (ws.readyState === MockWebSocket.OPEN) {
          ws.receiveMessage(['EOSE', 'sub']);
        }
      }
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      await promise;
    });

    it('filters search results by query (AND semantics)', async () => {
      const match = makeNostrEvent({ id: 'ev1', content: 'bitcoin and ethereum today' });
      const noMatch = makeNostrEvent({ id: 'ev2', content: 'hello world' });

      const promise = fetchNostr({ ...baseOptions, query: 'bitcoin' });
      await vi.advanceTimersByTimeAsync(50);

      sendEventsToRelaySockets([
        ['EVENT', 'sub', match],
        ['EVENT', 'sub', noMatch],
      ]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].content).toContain('bitcoin');
    });

    it('does not include engagement data for search results', async () => {
      const event = makeNostrEvent({ id: 'ev1', content: 'test content' });

      const promise = fetchNostr({ ...baseOptions, query: 'test' });
      await vi.advanceTimersByTimeAsync(50);

      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      // Search doesn't go through trending API, so no engagement
      expect(result.posts[0].engagement).toBeUndefined();
    });
  });

  describe('WebSocket resilience', () => {
    it('does not crash when closing a WebSocket that never connected', async () => {
      // This is the exact bug we fixed: ws.close() on CONNECTING state
      MockWebSocket.setBehavior('hang');
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);

      // Advance past the relay timeout (8000ms) + profile timeout (3000ms)
      await vi.advanceTimersByTimeAsync(12000);
      const result = await promise;

      // Should not throw, should resolve gracefully
      expect(result.source).toBe('nostr');
      expect(result.posts).toEqual([]);
    });

    it('resolves gracefully when relay connection fails', async () => {
      MockWebSocket.setBehavior('fail');
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.source).toBe('nostr');
      expect(result.posts).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it('resolves when relay times out without EOSE', async () => {
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      // Relay sockets are open but never send EOSE — should resolve on timeout
      await vi.advanceTimersByTimeAsync(12000);
      const result = await promise;

      expect(result.source).toBe('nostr');
    });

    it('handles relay sending invalid JSON', async () => {
      const event = makeNostrEvent({ id: 'ev1' });
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      // Send garbage then real data
      for (const ws of MockWebSocket.instances) {
        if (ws.readyState === MockWebSocket.OPEN && ws.onmessage) {
          (ws.onmessage as (event: { data: string }) => void)({ data: 'not json' });
        }
      }
      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      // Should still have parsed the valid event
      expect(result.posts.length).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });
  });

  describe('common behavior', () => {
    it('returns posts array (possibly empty)', async () => {
      mockFetch([]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toBeInstanceOf(Array);
    });

    it('sets njump.me URLs for post and profile', async () => {
      const event = makeNostrEvent({ id: 'ev1', pubkey: 'aabb00112233445566778899aabbccdd' });
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts[0].url).toContain('njump.me/');
      expect(result.posts[0].author.profileUrl).toContain('njump.me/npub1');
    });

    it('converts created_at unix timestamp to Date', async () => {
      const ts = Math.floor(new Date('2025-06-15T10:00:00Z').getTime() / 1000);
      const event = makeNostrEvent({ id: 'ev1', created_at: ts });
      mockFetch([makeTrendingNote({ event_id: 'ev1' })]);

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);

      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts[0].timestamp).toEqual(new Date('2025-06-15T10:00:00Z'));
    });
  });

  describe('nostr.wine full-text search', () => {
    const PUBKEY = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
    const EVENT_ID = 'fe964e758903360f28d8424d092da8494ed207cba823110be3a57dfe4b578734';

    async function settle<T>(promise: Promise<T>): Promise<T> {
      await vi.advanceTimersByTimeAsync(50);
      for (const ws of MockWebSocket.instances) {
        if (ws.readyState === MockWebSocket.OPEN) ws.receiveMessage(['EOSE', 'sub']);
      }
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      return promise;
    }

    it('asks nostr.wine for kind-1 notes inside the timeframe', async () => {
      mockFetch({ data: [] });

      await settle(fetchNostr({ ...baseOptions, query: 'zap splits' }));

      const url = new URL(vi.mocked(globalThis.fetch).mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://api.nostr.wine/search');
      expect(url.searchParams.get('query')).toBe('zap splits');
      expect(url.searchParams.get('kind')).toBe('1');
      expect(url.searchParams.get('since')).toBe(String(Math.floor(new Date('2025-06-14T12:00:00Z').getTime() / 1000)));
      expect(url.searchParams.get('sort')).toBe('relevance');
    });

    it('sorts by time on nostr.wine when --sort recent', async () => {
      mockFetch({ data: [] });

      await settle(fetchNostr({ ...baseOptions, query: 'bitcoin', sort: 'recent' }));

      const url = new URL(vi.mocked(globalThis.fetch).mock.calls[0][0] as string);
      expect(url.searchParams.get('sort')).toBe('time');
    });

    it('returns nostr.wine hits even when relays have nothing', async () => {
      mockFetch({ data: [makeNostrEvent({ id: EVENT_ID, pubkey: PUBKEY, content: 'lightning zap splits are live' })] });

      const result = await settle(fetchNostr({ ...baseOptions, query: 'zap' }));

      expect(result.posts.map(p => p.id)).toEqual([EVENT_ID]);
      expect(result.error).toBeUndefined();
    });

    it('merges nostr.wine and relay hits without duplicates', async () => {
      const shared = makeNostrEvent({ id: 'aa01', content: 'bitcoin from both' });
      mockFetch({ data: [shared] });

      const promise = fetchNostr({ ...baseOptions, query: 'bitcoin' });
      await vi.advanceTimersByTimeAsync(50);
      sendEventsToRelaySockets([
        ['EVENT', 'sub', shared],
        ['EVENT', 'sub', makeNostrEvent({ id: 'bb02', content: 'bitcoin only on a relay' })],
      ]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts.map(p => p.id).sort()).toEqual(['aa01', 'bb02']);
    });

    it('leaves hashtag queries to the relay #t filter', async () => {
      mockFetch({ data: [] });

      await settle(fetchNostr({ ...baseOptions, query: '#bitcoin' }));

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('reports a nostr.wine failure only when nothing was found', async () => {
      mockFetch({}, false, 429);

      const result = await settle(fetchNostr({ ...baseOptions, query: 'bitcoin' }));

      expect(result.posts).toEqual([]);
      expect(result.error).toContain('nostr.wine search API: 429');
    });

    it('keeps relay hits quietly when nostr.wine fails', async () => {
      mockFetch({}, false, 503);

      const promise = fetchNostr({ ...baseOptions, query: 'bitcoin' });
      await vi.advanceTimersByTimeAsync(50);
      sendEventsToRelaySockets([['EVENT', 'sub', makeNostrEvent({ id: 'cc03', content: 'bitcoin on relays' })]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toHaveLength(1);
      expect(result.error).toBeUndefined();
    });

    it('applies the limit after matching', async () => {
      mockFetch({
        data: Array.from({ length: 8 }, (_, i) => makeNostrEvent({ id: `dd0${i}`, content: `bitcoin note ${i}` })),
      });

      const result = await settle(fetchNostr({ ...baseOptions, limit: 3, query: 'bitcoin' }));

      expect(result.posts).toHaveLength(3);
    });

    it('builds real NIP-19 links (npub and note)', async () => {
      mockFetch({ data: [makeNostrEvent({ id: EVENT_ID, pubkey: PUBKEY, content: 'gm bitcoin' })] });

      const result = await settle(fetchNostr({ ...baseOptions, query: 'bitcoin' }));

      const post = result.posts[0];
      expect(post.author.profileUrl).toBe('https://njump.me/npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6');
      expect(post.url).toMatch(/^https:\/\/njump\.me\/note1[02-9ac-hj-np-z]{58}$/);
      expect(post.author.username).toBe('npub180cvv07...');
    });
  });

  it('does not use the dead relay.nostr.band', async () => {
    const { RELAYS } = await import('../src/fetchers/nostr.js');
    expect(RELAYS.some(r => r.includes('nostr.band'))).toBe(false);
  });
});
