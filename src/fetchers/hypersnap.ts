import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';
import { matchesQuery } from '../utils/search.js';

/**
 * Hypersnap is a community fork of Farcaster (github.com/farcasterorg/hypersnap).
 * Its nodes serve a Neynar-compatible `/v2/farcaster` HTTP API, and reads need
 * no API key. Point HYPERSNAP_NODE_URL at your own node to use it instead of
 * the public one.
 */
export const DEFAULT_HYPERSNAP_NODE = 'https://haatz.quilibrium.com';

/** Quilcast is a web client for Hypersnap; post and profile links open there. */
const WEB_CLIENT = 'https://quilcast.com';

const REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGE_SIZE = 100; // node caps `limit` at 100
const MAX_PAGES = 4;
const HYDRATE_BATCH = 25;

interface HypersnapCast {
  hash: string;
  author?: {
    fid?: number | string; // FIDs registered natively on Hypersnap come back as strings
    username?: string;
    display_name?: string;
  };
  text?: string;
  timestamp: string;
  reactions?: {
    likes_count?: number;
    recasts_count?: number;
  };
  replies?: {
    count?: number;
  };
  channel?: { id?: string } | null;
}

interface HypersnapFeedResponse {
  casts?: HypersnapCast[];
  next?: { cursor?: string | null };
}

interface HypersnapSearchResponse {
  result?: {
    casts?: HypersnapCast[];
    next?: { cursor?: string | null };
  };
}

interface HypersnapBulkResponse {
  casts?: HypersnapCast[];
}

export function getHypersnapNodeUrl(): string {
  const url = process.env.HYPERSNAP_NODE_URL?.trim() || DEFAULT_HYPERSNAP_NODE;
  return url.replace(/\/+$/, '');
}

/** Search results carry bare hex hashes; feeds carry 0x-prefixed ones. */
function normalizeHash(hash: string): string {
  const lower = hash.toLowerCase();
  return lower.startsWith('0x') ? lower : `0x${lower}`;
}

function hypersnapCastToPost(cast: HypersnapCast): Post {
  const hash = normalizeHash(cast.hash);
  const fid = cast.author?.fid;
  const username = cast.author?.username || '';

  return {
    id: hash,
    source: 'hypersnap' as const,
    author: {
      username: username || `fid:${fid}`,
      displayName: cast.author?.display_name || undefined,
      profileUrl: `${WEB_CLIENT}/u/${username || fid}`,
    },
    content: cast.text || '',
    timestamp: new Date(cast.timestamp),
    url: `${WEB_CLIENT}/c/${hash}`,
    engagement: {
      likes: cast.reactions?.likes_count || 0,
      reposts: cast.reactions?.recasts_count || 0,
      replies: cast.replies?.count || 0,
    },
    channel: cast.channel?.id || undefined,
  };
}

function mapTimeframeToWindow(timeframe: string): string {
  switch (timeframe) {
    case '24h': return '24h';
    case '48h': return '7d'; // no 48h window; take the 7d ranking and cut it to 48h
    case 'week': return '7d';
    default: return '24h';
  }
}

/**
 * The node decodes %XX but not `+`, so URLSearchParams (which writes spaces
 * as `+`) would turn "AI crypto" into "AI+crypto". Encode by hand instead.
 */
function buildQuery(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

async function getJson<T>(
  path: string,
  params: Record<string, string | undefined>,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${getHypersnapNodeUrl()}${path}?${buildQuery(params)}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json() as { message?: string };
        if (body?.message) detail = ` (${body.message})`;
      } catch {
        // body isn't JSON; the status code is enough
      }
      throw new Error(`Hypersnap ${label} API: ${response.status}${detail}`);
    }

    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Hypersnap ${label} API: no response from ${getHypersnapNodeUrl()} after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Page through a feed endpoint, keeping posts that pass `keep`, until there
 * are `limit` of them, the feed runs out, or MAX_PAGES is reached.
 */
async function fetchFeedPages(
  path: string,
  baseParams: Record<string, string>,
  label: string,
  limit: number,
  pageSize: number,
  keep: (post: Post) => boolean,
  chronological: boolean,
): Promise<Post[]> {
  const posts: Post[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await getJson<HypersnapFeedResponse>(
      path,
      { ...baseParams, limit: String(pageSize), cursor },
      label,
    );
    const casts = data.casts || [];
    if (casts.length === 0) break;

    const pagePosts = casts.map(hypersnapCastToPost);
    posts.push(...pagePosts.filter(keep));
    if (posts.length >= limit) break;

    cursor = data.next?.cursor || undefined;
    if (!cursor) break;

    // A newest-first feed whose page ends before the cutoff has nothing newer left
    if (chronological && pagePosts.every(p => !keep(p))) break;
  }

  return posts;
}

async function fetchHypersnapTrending(
  limit: number,
  timeframe: string,
  keep: (post: Post) => boolean,
): Promise<Post[]> {
  const window = mapTimeframeToWindow(timeframe);
  // When the window is wider than the timeframe, ask for full pages so the cut leaves enough
  const pageSize = timeframe === '48h' ? MAX_PAGE_SIZE : Math.min(limit, MAX_PAGE_SIZE);

  return fetchFeedPages(
    '/v2/farcaster/feed/trending',
    { time_window: window },
    'trending',
    limit,
    pageSize,
    keep,
    false,
  );
}

async function fetchHypersnapChannel(
  channel: string,
  limit: number,
  keep: (post: Post) => boolean,
  filtering: boolean,
): Promise<Post[]> {
  // A query is matched locally on channel feeds, so read wider pages
  const pageSize = filtering ? MAX_PAGE_SIZE : Math.min(limit, MAX_PAGE_SIZE);

  return fetchFeedPages(
    '/v2/farcaster/feed/channels',
    { channel_ids: channel },
    'channel feed',
    limit,
    pageSize,
    keep,
    true,
  );
}

async function fetchHypersnapSearch(
  query: string,
  limit: number,
  keep: (post: Post) => boolean,
): Promise<Post[]> {
  // Newest first: the node's default relevance order surfaces old casts
  // that the timeframe cut would then throw away.
  const data = await getJson<HypersnapSearchResponse>(
    '/v2/farcaster/cast/search',
    {
      q: query,
      sort_type: 'desc_chronological',
      limit: String(Math.min(limit * 2, MAX_PAGE_SIZE)),
    },
    'search',
  );

  const posts = (data.result?.casts || []).map(hypersnapCastToPost).filter(keep).slice(0, limit);
  return hydrateEngagement(posts);
}

/**
 * Search results come back without likes, recasts, replies or channel.
 * Fill them in from /cast/bulk; if that fails, keep the bare results.
 */
async function hydrateEngagement(posts: Post[]): Promise<Post[]> {
  if (posts.length === 0) return posts;

  const full = new Map<string, Post>();
  for (let i = 0; i < posts.length; i += HYDRATE_BATCH) {
    const batch = posts.slice(i, i + HYDRATE_BATCH);
    try {
      const data = await getJson<HypersnapBulkResponse>(
        '/v2/farcaster/cast/bulk',
        { hashes: batch.map(p => p.id).join(',') },
        'cast/bulk',
      );
      for (const cast of data.casts || []) {
        const post = hypersnapCastToPost(cast);
        full.set(post.id, post);
      }
    } catch {
      // engagement stays at zero for this batch
    }
  }

  return posts.map(post => full.get(post.id) || post);
}

export async function fetchHypersnap(options: SearchOptions): Promise<FetchResult> {
  const limit = options.limit || 25;
  const cutoff = getTimeframeCutoff(options.timeframe);
  const query = options.query;

  const keep = (post: Post): boolean =>
    post.timestamp >= cutoff &&
    post.content.trim().length > 0 &&
    (!query || matchesQuery(post.content, post.tags || [], query));

  try {
    let posts: Post[];

    if (options.channel) {
      // Node search can't be scoped to a channel, so read the channel and match locally
      posts = await fetchHypersnapChannel(options.channel, limit, keep, Boolean(query));
    } else if (query) {
      posts = await fetchHypersnapSearch(query, limit, keep);
    } else {
      posts = await fetchHypersnapTrending(limit, options.timeframe, keep);
    }

    return {
      posts: posts.slice(0, limit),
      source: 'hypersnap',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      posts: [],
      source: 'hypersnap',
      error: message,
    };
  }
}
