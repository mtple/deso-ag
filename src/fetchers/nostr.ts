import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';
import { matchesQuery } from '../utils/search.js';

// Public Nostr relays
const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
];

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

interface NostrProfile {
  name?: string;
  display_name?: string;
  nip05?: string;
}

interface TrendingNote {
  event_id: string;
  reactions: number;
  replies: number;
  reposts: number;
  zap_amount: number;
  zap_count: number;
}

export async function fetchNostr(options: SearchOptions): Promise<FetchResult> {
  const cutoff = getTimeframeCutoff(options.timeframe);

  try {
    let events: NostrEvent[];
    let engagementMap = new Map<string, TrendingNote>();

    if (options.query) {
      // For search queries, try nostr.band API first, fall back to relay-based search
      events = await searchWithFallback(options, cutoff);
    } else {
      // For trending, try multiple APIs with fallback
      const result = await fetchTrendingWithFallback(options);
      events = result.events;
      engagementMap = result.engagementMap;
    }

    const profileCache = new Map<string, NostrProfile>();

    // Fetch profiles for authors (in parallel, but limit concurrency)
    const uniquePubkeys = [...new Set(events.map(e => e.pubkey))].slice(0, 20);
    await fetchProfiles(uniquePubkeys, profileCache);

    const posts: Post[] = events
      .filter(event => event.content.trim().length > 0)
      .map(event => {
        const profile = profileCache.get(event.pubkey);
        const npub = pubkeyToNpub(event.pubkey);
        const trending = engagementMap.get(event.id);

        return {
          id: event.id,
          source: 'nostr' as const,
          author: {
            username: profile?.name || npub.slice(0, 12) + '...',
            displayName: profile?.display_name,
            profileUrl: `https://njump.me/${npub}`,
          },
          content: event.content,
          timestamp: new Date(event.created_at * 1000),
          url: `https://njump.me/${event.id}`,
          tags: extractHashtags(event.tags),
          ...(trending && {
            engagement: {
              likes: trending.reactions,
              reposts: trending.reposts,
              replies: trending.replies,
            },
          }),
        };
      });

    // Filter by query if provided (AND semantics for multi-word queries)
    const filteredPosts = options.query
      ? posts.filter(p => matchesQuery(p.content, p.tags || [], options.query!))
      : posts;

    return {
      posts: filteredPosts,
      source: 'nostr',
    };
  } catch (error) {
    return {
      posts: [],
      source: 'nostr',
      error: error instanceof Error ? error.message : 'Unknown error fetching from Nostr',
    };
  }
}

// ---------------------------------------------------------------------------
// Trending: try nostr.band → nostr.wine + relay fetch
// ---------------------------------------------------------------------------

interface TrendingResult {
  events: NostrEvent[];
  engagementMap: Map<string, TrendingNote>;
}

async function fetchTrendingWithFallback(options: SearchOptions): Promise<TrendingResult> {
  // Try nostr.band first (returns full events inline)
  try {
    return await fetchTrendingFromNostrBand(options);
  } catch {
    // ignore
  }

  // Fall back to nostr.wine (returns IDs only, needs relay fetch)
  try {
    return await fetchTrendingFromNostrWine(options);
  } catch {
    // ignore
  }

  // Last resort: fetch recent notes directly from relays (no engagement data)
  const cutoff = getTimeframeCutoff(options.timeframe);
  const events = await queryRelays(options, cutoff);
  return { events, engagementMap: new Map() };
}

async function fetchTrendingFromNostrBand(options: SearchOptions): Promise<TrendingResult> {
  const limit = options.limit || 25;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.nostr.band/v0/trending/notes', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`nostr.band trending API: ${response.status}`);
    }

    const data = await response.json() as {
      notes: Array<{
        event: NostrEvent;
        stats?: { replies?: number; reposts?: number; likes?: number; zaps?: number; zap_amount?: number };
      }>;
    };

    const notes = data.notes || [];
    const events: NostrEvent[] = [];
    const engagementMap = new Map<string, TrendingNote>();

    for (const note of notes.slice(0, limit)) {
      events.push(note.event);
      if (note.stats) {
        engagementMap.set(note.event.id, {
          event_id: note.event.id,
          reactions: note.stats.likes || 0,
          replies: note.stats.replies || 0,
          reposts: note.stats.reposts || 0,
          zap_amount: note.stats.zap_amount || 0,
          zap_count: note.stats.zaps || 0,
        });
      }
    }

    return { events, engagementMap };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function fetchTrendingFromNostrWine(options: SearchOptions): Promise<TrendingResult> {
  const limit = options.limit || 25;
  const hours = options.timeframe === 'week' ? 48 : options.timeframe === '48h' ? 48 : 24;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `https://api.nostr.wine/trending?order=reactions&hours=${hours}&limit=${Math.min(limit, 100)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`nostr.wine API: ${response.status}`);
    }

    const trending = await response.json() as TrendingNote[];
    const engagementMap = new Map(trending.map(t => [t.event_id, t]));
    const eventIds = trending.map(t => t.event_id);
    const events = await fetchEventsByIds(eventIds);

    return { events, engagementMap };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Search: try nostr.band API → relay-based search
// ---------------------------------------------------------------------------

async function searchWithFallback(options: SearchOptions, cutoff: Date): Promise<NostrEvent[]> {
  // Try nostr.band search API first
  try {
    const events = await searchNostrBand(options);
    if (events.length > 0) return events;
  } catch {
    // ignore
  }

  // Fall back to relay-based search
  return queryRelays(options, cutoff);
}

async function searchNostrBand(options: SearchOptions): Promise<NostrEvent[]> {
  const limit = options.limit || 50;
  const query = options.query || '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const params = new URLSearchParams({
      q: query,
      type: 'posts',
      limit: String(Math.min(limit, 100)),
    });
    const response = await fetch(`https://api.nostr.band/v0/search?${params}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`nostr.band search API: ${response.status}`);
    }

    const data = await response.json() as {
      notes: Array<{ event: NostrEvent }>;
    };

    return (data.notes || []).map(n => n.event);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Relay-based fetching (WebSocket)
// ---------------------------------------------------------------------------

async function fetchEventsByIds(eventIds: string[]): Promise<NostrEvent[]> {
  if (eventIds.length === 0) return [];

  const events: NostrEvent[] = [];
  const seenIds = new Set<string>();

  // Query multiple relays in parallel for the specific event IDs
  const promises = RELAYS.slice(0, 3).map(relay =>
    queryRelayByIds(relay, eventIds).catch(() => [] as NostrEvent[])
  );

  const results = await Promise.all(promises);

  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (!seenIds.has(event.id)) {
        seenIds.add(event.id);
        events.push(event);
      }
    }
  }

  return events;
}

async function queryRelayByIds(relay: string, ids: string[]): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let ws: WebSocket | null = null;

    const timeout = setTimeout(() => {
      safeClose(ws);
      resolve(events);
    }, 8000);

    try {
      ws = new WebSocket(relay);

      ws.onopen = () => {
        const filter = {
          ids,
          kinds: [1],
        };
        const subId = Math.random().toString(36).slice(2, 10);
        ws?.send(JSON.stringify(['REQ', subId, filter]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string);
          if (data[0] === 'EVENT' && data[2]) {
            events.push(data[2] as NostrEvent);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            safeClose(ws);
            resolve(events);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(events);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve(events);
      };
    } catch {
      clearTimeout(timeout);
      resolve(events);
    }
  });
}

async function queryRelays(options: SearchOptions, cutoff: Date): Promise<NostrEvent[]> {
  const since = Math.floor(cutoff.getTime() / 1000);
  const limit = options.limit || 50;
  const events: NostrEvent[] = [];
  const seenIds = new Set<string>();

  // Query multiple relays in parallel
  const promises = RELAYS.slice(0, 3).map(relay =>
    queryRelay(relay, since, limit, options.query)
      .catch(() => [] as NostrEvent[])
  );

  const results = await Promise.all(promises);

  for (const relayEvents of results) {
    for (const event of relayEvents) {
      if (!seenIds.has(event.id)) {
        seenIds.add(event.id);
        events.push(event);
      }
    }
  }

  // Sort by timestamp descending
  events.sort((a, b) => b.created_at - a.created_at);
  return events.slice(0, limit);
}

async function queryRelay(relay: string, since: number, limit: number, query?: string): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let ws: WebSocket | null = null;

    const timeout = setTimeout(() => {
      safeClose(ws);
      resolve(events);
    }, 5000);

    try {
      // Use global WebSocket (polyfilled by websocket-polyfill in Node)
      ws = new WebSocket(relay);

      ws.onopen = () => {
        const filter: Record<string, unknown> = {
          kinds: [1], // Text notes only
          since,
          limit: Math.min(limit, 100),
        };

        // If query contains #hashtag, search by tag
        if (query?.startsWith('#')) {
          filter['#t'] = [query.slice(1).toLowerCase()];
        }

        const subId = Math.random().toString(36).slice(2, 10);
        ws?.send(JSON.stringify(['REQ', subId, filter]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string);
          if (data[0] === 'EVENT' && data[2]) {
            events.push(data[2] as NostrEvent);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            safeClose(ws);
            resolve(events);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(events);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve(events);
      };
    } catch {
      clearTimeout(timeout);
      resolve(events);
    }
  });
}

// ---------------------------------------------------------------------------
// Profile fetching
// ---------------------------------------------------------------------------

async function fetchProfiles(pubkeys: string[], cache: Map<string, NostrProfile>): Promise<void> {
  if (pubkeys.length === 0) return;

  const relay = RELAYS[0];

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    const timeout = setTimeout(() => {
      safeClose(ws);
      resolve();
    }, 3000);

    try {
      ws = new WebSocket(relay);

      ws.onopen = () => {
        const filter = {
          kinds: [0], // Metadata
          authors: pubkeys,
        };
        const subId = 'profiles-' + Math.random().toString(36).slice(2, 6);
        ws?.send(JSON.stringify(['REQ', subId, filter]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data as string);
          if (data[0] === 'EVENT' && data[2]) {
            const event = data[2] as NostrEvent;
            const profile = JSON.parse(event.content) as NostrProfile;
            cache.set(event.pubkey, profile);
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout);
            safeClose(ws);
            resolve();
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve();
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        resolve();
      };
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHashtags(tags: string[][]): string[] {
  return tags
    .filter(tag => tag[0] === 't')
    .map(tag => tag[1]);
}

/**
 * Safely close a WebSocket, guarding against the websocket-polyfill crash
 * where close() throws if the connection was never established.
 */
function safeClose(ws: WebSocket | null): void {
  if (!ws) return;
  try {
    ws.close();
  } catch {
    // websocket-polyfill throws if connection_ is undefined (never connected)
  }
}

function pubkeyToNpub(pubkey: string): string {
  // Simplified npub encoding (returns hex for now, full bech32 requires more deps)
  // In production, use nostr-tools nip19.npubEncode
  return `npub1${pubkey.slice(0, 20)}`;
}
