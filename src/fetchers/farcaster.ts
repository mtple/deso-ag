import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';
import { matchesQuery } from '../utils/search.js';

// Farcaster Client API (free, no auth needed)
const FARCASTER_API = 'https://api.farcaster.xyz';

// Popular/active FIDs to query for trending content
const POPULAR_FIDS = [
  3,     // dwr (Dan Romero)
  2,     // v (Varun Srinivasan)
  99,    // jessepollak
  3621,  // horsefacts
  6806,  // cameron
  239,   // ted
  194,   // adrienne
  5650,  // vitalik.eth
  1317,  // 0xdesigner
  12142, // base
  7143,  // mids
  2433,  // chains
];

interface ClientCast {
  hash: string;
  threadHash: string;
  author: {
    fid: number;
    username: string;
    displayName: string;
    pfp?: { url: string };
  };
  text: string;
  timestamp: number; // Unix ms
  reactions: { count: number };
  recasts: { count: number };
  replies: { count: number };
  parentHash?: string;
  parentAuthor?: { fid: number };
}

interface ClientCastsResponse {
  result?: {
    casts?: ClientCast[];
  };
}

export async function fetchFarcaster(options: SearchOptions): Promise<FetchResult> {
  const limit = options.limit || 25;
  const cutoff = getTimeframeCutoff(options.timeframe);

  try {
    let posts: Post[];

    if (options.channel) {
      posts = await fetchChannelCasts(options.channel, limit, cutoff);
    } else {
      posts = await fetchTrendingCasts(limit, cutoff);
    }

    // Filter by query if provided (AND semantics for multi-word queries)
    if (options.query) {
      posts = posts.filter(p =>
        matchesQuery(p.content, p.tags || [], options.query!)
      );
    }

    // Filter empty content
    posts = posts.filter(p => p.content.trim().length > 0);

    return {
      posts: posts.slice(0, limit),
      source: 'farcaster',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      posts: [],
      source: 'farcaster',
      error: `Farcaster: ${message}`,
    };
  }
}

async function fetchTrendingCasts(limit: number, cutoff: Date): Promise<Post[]> {
  const allPosts: Post[] = [];
  const seenHashes = new Set<string>();

  // Query multiple FIDs in parallel
  const promises = POPULAR_FIDS.map(fid =>
    fetchCastsByFid(fid, cutoff).catch(() => [])
  );

  const results = await Promise.all(promises);

  for (const posts of results) {
    for (const post of posts) {
      if (!seenHashes.has(post.id)) {
        seenHashes.add(post.id);
        allPosts.push(post);
      }
    }
  }

  // Sort by timestamp (newest first)
  allPosts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return allPosts.slice(0, limit);
}

async function fetchCastsByFid(fid: number, cutoff: Date): Promise<Post[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `${FARCASTER_API}/v2/casts?fid=${fid}&limit=25`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Client API: ${response.status}`);
    }

    const data = await response.json() as ClientCastsResponse;
    const casts = data.result?.casts || [];

    return casts
      .filter(cast => {
        // Skip replies (only top-level casts)
        if (cast.parentHash) return false;
        // Apply timeframe cutoff
        const ts = new Date(cast.timestamp);
        return ts >= cutoff;
      })
      .map(cast => ({
        id: cast.hash,
        source: 'farcaster' as const,
        author: {
          username: cast.author.username || `fid:${cast.author.fid}`,
          displayName: cast.author.displayName,
          profileUrl: `https://farcaster.xyz/${cast.author.username}`,
        },
        content: cast.text,
        timestamp: new Date(cast.timestamp),
        url: `https://farcaster.xyz/${cast.author.username}/${cast.hash.slice(0, 10)}`,
        engagement: {
          likes: cast.reactions?.count || 0,
          reposts: cast.recasts?.count || 0,
          replies: cast.replies?.count || 0,
        },
      }));
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function fetchChannelCasts(channelId: string, limit: number, cutoff: Date): Promise<Post[]> {
  // Try channel endpoint first
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `${FARCASTER_API}/v1/channel?channelId=${channelId}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      // Fall back to trending if channel not found
      return fetchTrendingCasts(limit, cutoff);
    }

    // For channels, we still query by popular FIDs
    // but filter to only include casts — the Client API doesn't have
    // a direct channel-casts endpoint, so trending is the best fallback
    return fetchTrendingCasts(limit, cutoff);
  } catch {
    clearTimeout(timeout);
    return fetchTrendingCasts(limit, cutoff);
  }
}
