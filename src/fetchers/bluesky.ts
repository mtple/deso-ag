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
  accessJwt: string,
  query: string,
  limit: number,
): Promise<Post[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(limit, 100)),
    sort: 'top',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${BSKY_APPVIEW}/app.bsky.feed.searchPosts?${params}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessJwt}`,
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Bluesky search API: ${response.status}`);
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
      // Search requires authentication
      const identifier = process.env.BLUESKY_IDENTIFIER;
      const appPassword = process.env.BLUESKY_APP_PASSWORD;
      if (!identifier || !appPassword) {
        return {
          posts: [],
          source: 'bluesky',
          error: 'Bluesky search requires BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD. Create an app password at https://bsky.app/settings/app-passwords',
        };
      }

      const session = await createSession(identifier, appPassword);
      posts = await searchBluesky(session.accessJwt, options.query, limit);
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
