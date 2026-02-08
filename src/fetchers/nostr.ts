import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';

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

export async function fetchNostr(options: SearchOptions): Promise<FetchResult> {
  const cutoff = getTimeframeCutoff(options.timeframe);

  try {
    const events = await queryRelays(options, cutoff);
    const profileCache = new Map<string, NostrProfile>();

    // Fetch profiles for authors (in parallel, but limit concurrency)
    const uniquePubkeys = [...new Set(events.map(e => e.pubkey))].slice(0, 20);
    await fetchProfiles(uniquePubkeys, profileCache);

    const posts: Post[] = events.map(event => {
      const profile = profileCache.get(event.pubkey);
      const npub = pubkeyToNpub(event.pubkey);

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
      };
    });

    // Filter by query if provided
    const filteredPosts = options.query
      ? posts.filter(p => 
          p.content.toLowerCase().includes(options.query!.toLowerCase()) ||
          p.tags?.some(t => t.toLowerCase().includes(options.query!.toLowerCase()))
        )
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
      if (ws) ws.close();
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
            ws?.close();
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

async function fetchProfiles(pubkeys: string[], cache: Map<string, NostrProfile>): Promise<void> {
  if (pubkeys.length === 0) return;

  const relay = RELAYS[0];
  
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    const timeout = setTimeout(() => {
      if (ws) ws.close();
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
            ws?.close();
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

function extractHashtags(tags: string[][]): string[] {
  return tags
    .filter(tag => tag[0] === 't')
    .map(tag => tag[1]);
}

function pubkeyToNpub(pubkey: string): string {
  // Simplified npub encoding (returns hex for now, full bech32 requires more deps)
  // In production, use nostr-tools nip19.npubEncode
  return `npub1${pubkey.slice(0, 20)}`;
}
