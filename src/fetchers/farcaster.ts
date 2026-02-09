import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';
import { matchesQuery } from '../utils/search.js';

const NEYNAR_API = 'https://api.neynar.com/v2/farcaster';

interface NeynarCast {
  hash: string;
  author: {
    fid: number;
    username: string;
    display_name: string;
  };
  text: string;
  timestamp: string;
  reactions: {
    likes_count: number;
    recasts_count: number;
  };
  replies: {
    count: number;
  };
}

interface NeynarTrendingResponse {
  casts: NeynarCast[];
  next?: { cursor: string };
}

interface NeynarSearchResponse {
  result: {
    casts: NeynarCast[];
    next?: { cursor: string };
  };
}

function neynarCastToPost(cast: NeynarCast): Post {
  return {
    id: cast.hash,
    source: 'farcaster' as const,
    author: {
      username: cast.author.username || `fid:${cast.author.fid}`,
      displayName: cast.author.display_name,
      profileUrl: `https://farcaster.xyz/${cast.author.username}`,
    },
    content: cast.text,
    timestamp: new Date(cast.timestamp),
    url: `https://farcaster.xyz/${cast.author.username}/${cast.hash.slice(0, 10)}`,
    engagement: {
      likes: cast.reactions?.likes_count || 0,
      reposts: cast.reactions?.recasts_count || 0,
      replies: cast.replies?.count || 0,
    },
  };
}

function mapTimeframeToWindow(timeframe: string): string {
  switch (timeframe) {
    case '24h': return '24h';
    case '48h': return '24h'; // closest available
    case 'week': return '7d';
    default: return '24h';
  }
}

export async function fetchFarcaster(options: SearchOptions): Promise<FetchResult> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    return {
      posts: [],
      source: 'farcaster',
      error: 'Farcaster requires NEYNAR_API_KEY. Get one at https://neynar.com',
    };
  }

  const limit = options.limit || 25;
  const cutoff = getTimeframeCutoff(options.timeframe);

  try {
    let posts: Post[];

    if (options.query) {
      posts = await fetchNeynarSearch(apiKey, options.query, limit, options.channel);
    } else {
      posts = await fetchNeynarTrending(apiKey, limit, options.timeframe, options.channel);
    }

    // Apply timeframe cutoff
    posts = posts.filter(p => p.timestamp >= cutoff);

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

async function fetchNeynarTrending(
  apiKey: string,
  limit: number,
  timeframe: string,
  channel?: string,
): Promise<Post[]> {
  const timeWindow = mapTimeframeToWindow(timeframe);
  const allPosts: Post[] = [];
  let cursor: string | undefined;

  // Neynar trending limit is 1-10 per request, so paginate
  while (allPosts.length < limit) {
    const batchSize = Math.min(10, limit - allPosts.length);
    const params = new URLSearchParams({
      limit: String(batchSize),
      time_window: timeWindow,
    });
    if (channel) params.set('channel_id', channel);
    if (cursor) params.set('cursor', cursor);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(`${NEYNAR_API}/feed/trending?${params}`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'x-api-key': apiKey,
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Neynar trending API: ${response.status}`);
      }

      const data = await response.json() as NeynarTrendingResponse;
      const casts = data.casts || [];

      if (casts.length === 0) break;

      for (const cast of casts) {
        allPosts.push(neynarCastToPost(cast));
      }

      cursor = data.next?.cursor;
      if (!cursor) break;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  return allPosts;
}

async function fetchNeynarSearch(
  apiKey: string,
  query: string,
  limit: number,
  channel?: string,
): Promise<Post[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 100)),
  });
  if (channel) params.set('channel_id', channel);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${NEYNAR_API}/cast/search?${params}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'x-api-key': apiKey,
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Neynar search API: ${response.status}`);
    }

    const data = await response.json() as NeynarSearchResponse;
    const casts = data.result?.casts || [];

    return casts.map(neynarCastToPost);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}
