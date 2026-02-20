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
    // Simulate the real websocket-polyfill crash when not connected
    if (this.readyState !== MockWebSocket.OPEN && this.readyState !== MockWebSocket.CLOSING) {
      throw new TypeError("Cannot read properties of undefined (reading 'sendCloseFrame')");
    }
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) (this.onclose as () => void)();
  }

  receiveMessage(data: unknown) {
    if (this.onmessage) {
      (this.onmessage as (event: { data: string }) => void)({ data: JSON.stringify(data) });
    }
  }
}

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

  const baseOptions: SearchOptions = {
    sources: ['nostr'],
    timeframe: '24h',
    limit: 5,
  };

  describe('trending (no query)', () => {
    it('returns source as nostr', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [] }),
      });

      const result = await fetchNostr(baseOptions);

      expect(result.source).toBe('nostr');
    });

    it('tries nostr.band trending API first', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
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
        if (url.includes('nostr.band')) {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
        }
        // nostr.wine fallback returns empty trending
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      });

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.source).toBe('nostr');
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('falls back to relays when both APIs fail', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const promise = fetchNostr(baseOptions);
      // Let relay connections open and timeout
      await vi.advanceTimersByTimeAsync(100);

      // Send EOSE from relay sockets so they resolve
      for (const ws of MockWebSocket.instances) {
        if (ws.readyState === MockWebSocket.OPEN) {
          ws.receiveMessage(['EOSE', 'sub']);
        }
      }
      await vi.advanceTimersByTimeAsync(100);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.source).toBe('nostr');
      expect(result.posts).toBeInstanceOf(Array);
    });

    it('maps nostr.band events to Post shape with engagement', async () => {
      const event = makeNostrEvent({ id: 'ev1', content: 'Trending nostr post' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          notes: [{
            event,
            stats: { likes: 20, reposts: 8, replies: 4, zaps: 2, zap_amount: 1000 },
          }],
        }),
      });

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
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

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event }] }),
      });

      const promise = fetchNostr(baseOptions);
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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event }] }),
      });

      const promise = fetchNostr(baseOptions);
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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event }] }),
      });

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts[0].tags).toEqual(['bitcoin', 'nostr']);
    });

    it('filters empty content', async () => {
      const empty = makeNostrEvent({ id: 'ev1', content: '   ' });
      const real = makeNostrEvent({ id: 'ev2', content: 'real content' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event: empty }, { event: real }] }),
      });

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].content).toBe('real content');
    });

    it('returns error on network failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const promise = fetchNostr(baseOptions);
      // Let relay fallback timeouts fire
      await vi.advanceTimersByTimeAsync(12000);
      const result = await promise;

      expect(result.posts).toBeInstanceOf(Array);
      expect(result.source).toBe('nostr');
    });

    it('returns empty posts when trending returns empty notes', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [] }),
      });

      const result = await fetchNostr(baseOptions);

      expect(result.posts).toEqual([]);
      expect(result.error).toBeUndefined();
    });
  });

  describe('search (with query)', () => {
    it('tries nostr.band search API first', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event: makeNostrEvent({ content: 'bitcoin price' }) }] }),
      });

      const promise = fetchNostr({ ...baseOptions, query: 'bitcoin' });
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      const calls = vi.mocked(globalThis.fetch).mock.calls;
      const url = calls[0][0] as string;
      expect(url).toContain('api.nostr.band/v0/search');
      expect(url).toContain('q=bitcoin');
      expect(result.posts.length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to nostr.wine search when nostr.band fails', async () => {
      const event = makeNostrEvent({ content: 'bitcoin stuff' });
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        if (url.includes('nostr.band')) {
          return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
        }
        // nostr.wine search returns events
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [event] }),
        });
      });

      const promise = fetchNostr({ ...baseOptions, query: 'bitcoin' });
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(callCount).toBeGreaterThanOrEqual(2);
      expect(result.posts.length).toBeGreaterThanOrEqual(1);
    });

    it('falls back to relay search when all APIs fail', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const event = makeNostrEvent({ content: 'bitcoin from relay' });
      const promise = fetchNostr({ ...baseOptions, query: 'bitcoin' });
      await vi.advanceTimersByTimeAsync(50);

      // Relay sockets should have opened as fallback
      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts.length).toBeGreaterThanOrEqual(1);
      expect(result.posts[0].content).toContain('bitcoin');
    });

    it('filters search results by query (AND semantics)', async () => {
      const match = makeNostrEvent({ id: 'ev1', content: 'bitcoin and ethereum today' });
      const noMatch = makeNostrEvent({ id: 'ev2', content: 'hello world' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event: match }, { event: noMatch }] }),
      });

      const promise = fetchNostr({ ...baseOptions, query: 'bitcoin' });
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toHaveLength(1);
      expect(result.posts[0].content).toContain('bitcoin');
    });

    it('does not include engagement data for search results', async () => {
      const event = makeNostrEvent({ id: 'ev1', content: 'test content' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event }] }),
      });

      const promise = fetchNostr({ ...baseOptions, query: 'test' });
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts[0].engagement).toBeUndefined();
    });

    it('sends hashtag filter when relay search with # query', async () => {
      // Make both APIs fail so it falls to relay search
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

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
  });

  describe('WebSocket resilience', () => {
    it('does not crash when closing a WebSocket that never connected', async () => {
      MockWebSocket.setBehavior('hang');
      // Make both APIs fail so it falls to relay search
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const promise = fetchNostr(baseOptions);
      // Advance past all timeouts (relay 8s + profile 3s)
      await vi.advanceTimersByTimeAsync(12000);
      const result = await promise;

      // Should not throw, should resolve gracefully
      expect(result.source).toBe('nostr');
      expect(result.posts).toEqual([]);
    });

    it('resolves gracefully when relay connection fails', async () => {
      MockWebSocket.setBehavior('fail');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.source).toBe('nostr');
      expect(result.posts).toEqual([]);
    });

    it('resolves when relay times out without EOSE', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);
      // Relays are open but never send EOSE — should resolve on timeout
      await vi.advanceTimersByTimeAsync(12000);
      const result = await promise;

      expect(result.source).toBe('nostr');
    });

    it('handles relay sending invalid JSON', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const event = makeNostrEvent({ id: 'ev1', content: 'valid content' });
      const promise = fetchNostr({ ...baseOptions, query: 'valid' });
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

      expect(result.error).toBeUndefined();
    });
  });

  describe('common behavior', () => {
    it('returns posts array (possibly empty)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [] }),
      });

      const result = await fetchNostr(baseOptions);

      expect(result.posts).toBeInstanceOf(Array);
    });

    it('sets njump.me URLs for post and profile', async () => {
      const event = makeNostrEvent({ id: 'ev1', pubkey: 'aabb00112233445566778899aabbccdd' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event }] }),
      });

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts[0].url).toContain('njump.me/');
      expect(result.posts[0].author.profileUrl).toContain('njump.me/npub1');
    });

    it('converts created_at unix timestamp to Date', async () => {
      const ts = Math.floor(new Date('2025-06-15T10:00:00Z').getTime() / 1000);
      const event = makeNostrEvent({ id: 'ev1', created_at: ts });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ notes: [{ event }] }),
      });

      const promise = fetchNostr(baseOptions);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts[0].timestamp).toEqual(new Date('2025-06-15T10:00:00Z'));
    });

    it('deduplicates events across relays', async () => {
      // Force relay fallback
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      });

      const event = makeNostrEvent({ id: 'ev1', content: 'duplicate test' });
      const promise = fetchNostr({ ...baseOptions, query: 'duplicate' });
      await vi.advanceTimersByTimeAsync(50);

      // Every relay returns the same event
      sendEventsToRelaySockets([['EVENT', 'sub', event]]);
      await vi.advanceTimersByTimeAsync(50);
      sendEoseToProfileSocket();
      const result = await promise;

      expect(result.posts).toHaveLength(1);
    });
  });
});
