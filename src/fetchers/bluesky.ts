import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';
import { matchesQuery } from '../utils/search.js';

const BSKY_PUBLIC = 'https://public.api.bsky.app/xrpc';
const BSKY_PDS = 'https://bsky.social/xrpc';
const BSKY_APPVIEW = 'https://api.bsky.app/xrpc';

// Bluesky's official "What's Hot" feed generator
const WHATS_HOT_URI = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

interface BskyAuthor {
  did: string;
  handle: string;
  displayName?: string;
}

interface BskyPost {
  uri: string;
  cid: string;
  author: BskyAuthor;
  record: {
    text: string;
    createdAt: string;
    tags?: string[];
  };
  likeCount?: number;
  replyCount?: number;
  repostCount?: number;
  quoteCount?: number;
}

interface BskyFeedResponse {
  feed: Array<{ post: BskyPost }>;
  cursor?: string;
}

interface BskySearchResponse {
  posts: BskyPost[];
  cursor?: string;
}

interface BskySession {
  accessJwt: string;
  did: string;
}

class BskyHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// Access tokens last about two hours; reuse one for an hour instead of logging in on every search
const SESSION_TTL_MS = 60 * 60 * 1000;
let cachedSession: { key: string; accessJwt: string; expiresAt: number } | undefined;

/** Forget the cached Bluesky login (mainly for tests). */
export function resetBlueskySession(): void {
  cachedSession = undefined;
}

async function getAccessToken(identifier: string, password: string, forceNew = false): Promise<string> {
  const key = identifier;
  if (!forceNew && cachedSession && cachedSession.key === key && cachedSession.expiresAt > Date.now()) {
    return cachedSession.accessJwt;
  }
  const session = await createSession(identifier, password);
  cachedSession = { key, accessJwt: session.accessJwt, expiresAt: Date.now() + SESSION_TTL_MS };
  return session.accessJwt;
}

function bskyPostToPost(post: BskyPost): Post {
  // Extract rkey from AT URI: at://did/app.bsky.feed.post/rkey
  const rkey = post.uri.split('/').pop() || '';

  return {
    id: post.uri,
    source: 'bluesky' as const,
    author: {
      username: post.author.handle,
      displayName: post.author.displayName,
      profileUrl: `https://bsky.app/profile/${post.author.handle}`,
    },
    content: post.record.text,
    timestamp: new Date(post.record.createdAt),
    url: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
    engagement: {
      likes: post.likeCount || 0,
      reposts: (post.repostCount || 0) + (post.quoteCount || 0),
      replies: post.replyCount || 0,
    },
    tags: post.record.tags,
  };
}

/**
 * Fetch trending posts via the public "What's Hot" feed generator.
 * No auth required.
 */
async function fetchWhatsHot(limit: number): Promise<Post[]> {
  const params = new URLSearchParams({
    feed: WHATS_HOT_URI,
    limit: String(Math.min(limit, 100)),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${BSKY_PUBLIC}/app.bsky.feed.getFeed?${params}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Bluesky feed API: ${response.status}`);
    }

    const data = await response.json() as BskyFeedResponse;
    return (data.feed || []).map(item => bskyPostToPost(item.post));
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function createSession(identifier: string, password: string): Promise<BskySession> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${BSKY_PDS}/com.atproto.server.createSession`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Bluesky auth failed: ${response.status}`);
    }

    const data = await response.json() as BskySession;
    return data;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

async function searchBluesky(
  accessJwt: string | undefined,
  query: string,
  limit: number,
  since: Date,
  sort: 'top' | 'latest',
): Promise<Post[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 100)),
    sort,
    // Without this, `top` ranks all-time posts and the timeframe cut leaves almost nothing
    since: since.toISOString(),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const base = accessJwt ? BSKY_APPVIEW : BSKY_PUBLIC;
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (accessJwt) headers['Authorization'] = `Bearer ${accessJwt}`;

    const response = await fetch(`${base}/app.bsky.feed.searchPosts?${params}`, {
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new BskyHttpError(`Bluesky search API: ${response.status}`, response.status);
    }

    const data = await response.json() as BskySearchResponse;
    const posts = data.posts || [];

    return posts.map(bskyPostToPost);
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

export async function fetchBluesky(options: SearchOptions): Promise<FetchResult> {
  const limit = options.limit || 25;
  const cutoff = getTimeframeCutoff(options.timeframe);

  try {
    let posts: Post[];

    if (options.query) {
      const identifier = process.env.BLUESKY_IDENTIFIER;
      const appPassword = process.env.BLUESKY_APP_PASSWORD;
      const sort = options.sort === 'recent' ? 'latest' : 'top';

      if (identifier && appPassword) {
        let token = await getAccessToken(identifier, appPassword);
        try {
          posts = await searchBluesky(token, options.query, limit, cutoff, sort);
        } catch (error) {
          // A cached token can expire early (password change, server restart): log in again once
          if (!(error instanceof BskyHttpError) || (error.status !== 400 && error.status !== 401)) throw error;
          token = await getAccessToken(identifier, appPassword, true);
          posts = await searchBluesky(token, options.query, limit, cutoff, sort);
        }
      } else {
        // Try the public AppView first; it may refuse search without a login
        try {
          posts = await searchBluesky(undefined, options.query, limit, cutoff, sort);
        } catch (error) {
          if (error instanceof BskyHttpError && (error.status === 401 || error.status === 403)) {
            return {
              posts: [],
              source: 'bluesky',
              error: 'Bluesky search requires BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD. Create an app password at https://bsky.app/settings/app-passwords',
            };
          }
          throw error;
        }
      }
    } else {
      // Trending uses the public "What's Hot" feed — no auth needed
      posts = await fetchWhatsHot(limit);
    }

    // Apply timeframe cutoff client-side
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
      source: 'bluesky',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      posts: [],
      source: 'bluesky',
      error: `Bluesky: ${message}`,
    };
  }
}
