import type { Post, SearchOptions, FetchResult } from '../types.js';
import { getTimeframeCutoff } from '../utils/time.js';
import { matchesQuery } from '../utils/search.js';

// Lens V3 API endpoint
const LENS_API = 'https://api.lens.xyz/graphql';

const REQUEST_TIMEOUT_MS = 10000;
const MAX_PAGES = 3;

/**
 * Every Lens v3 post metadata type that carries text. Image, video, audio
 * and the rest keep their caption in `content`, so they count as posts too.
 */
const METADATA_TYPES = [
  'TextOnlyMetadata',
  'ArticleMetadata',
  'LinkMetadata',
  'ImageMetadata',
  'VideoMetadata',
  'AudioMetadata',
  'EmbedMetadata',
  'EventMetadata',
  'CheckingInMetadata',
  'LivestreamMetadata',
  'MintMetadata',
  'SpaceMetadata',
  'StoryMetadata',
  'ThreeDMetadata',
  'TransactionMetadata',
];

interface LensPost {
  slug: string;
  timestamp: string;
  author: {
    username?: { value: string; localName: string };
    metadata?: { name?: string };
  };
  metadata?: {
    content?: string;
  };
  stats?: {
    reactions: number;
    reposts: number;
    comments: number;
  };
}

interface LensResponse {
  data?: {
    posts?: {
      items: (LensPost | Record<string, never>)[];
      pageInfo?: { next?: string | null };
    };
  };
  errors?: Array<{ message: string }>;
}

const POSTS_QUERY = `
  query GetPosts($request: PostsRequest!) {
    posts(request: $request) {
      items {
        ... on Post {
          slug
          timestamp
          author {
            username {
              value
              localName
            }
            metadata {
              name
            }
          }
          metadata {
            ${METADATA_TYPES.map(t => `... on ${t} { content }`).join('\n            ')}
          }
          stats {
            reactions
            reposts
            comments
          }
        }
      }
      pageInfo {
        next
      }
    }
  }
`;

function lensPostToPost(post: LensPost): Post {
  const localName = post.author?.username?.localName;
  return {
    id: post.slug,
    source: 'lens' as const,
    author: {
      username: localName || post.author?.username?.value || 'unknown',
      displayName: post.author?.metadata?.name,
      profileUrl: localName ? `https://hey.xyz/u/${localName}` : undefined,
    },
    content: post.metadata?.content || '',
    timestamp: new Date(post.timestamp),
    url: `https://hey.xyz/posts/${post.slug}`,
    engagement: {
      likes: post.stats?.reactions || 0,
      reposts: post.stats?.reposts || 0,
      replies: post.stats?.comments || 0,
    },
  };
}

export async function fetchLens(options: SearchOptions): Promise<FetchResult> {
  const limit = options.limit || 25;
  const cutoff = getTimeframeCutoff(options.timeframe);
  const query = options.query;

  const keep = (post: Post): boolean =>
    post.timestamp >= cutoff &&
    post.content.trim().length > 0 &&
    (!query || matchesQuery(post.content, post.tags || [], query));

  try {
    const posts: Post[] = [];
    let cursor: string | undefined;

    // Without a query the feed is newest-first, so read until the window closes;
    // with one, read a few pages of search results
    for (let page = 0; page < MAX_PAGES; page++) {
      const { items, next } = await fetchLensPage(query, cursor);
      const pagePosts = items
        .filter((item): item is LensPost => Boolean(item && 'slug' in item && item.timestamp))
        .map(lensPostToPost);

      posts.push(...pagePosts.filter(keep));
      if (posts.length >= limit) break;

      cursor = next || undefined;
      if (!cursor || pagePosts.length === 0) break;
      if (!query && pagePosts.every(p => p.timestamp < cutoff)) break;
    }

    return {
      posts: posts.slice(0, limit),
      source: 'lens',
    };
  } catch (error) {
    return {
      posts: [],
      source: 'lens',
      error: error instanceof Error ? error.message : 'Unknown error fetching from Lens',
    };
  }
}

async function fetchLensPage(
  searchQuery: string | undefined,
  cursor: string | undefined,
): Promise<{ items: (LensPost | Record<string, never>)[]; next?: string | null }> {
  const request: Record<string, unknown> = { pageSize: 'FIFTY' };
  if (searchQuery) request.filter = { searchQuery };
  if (cursor) request.cursor = cursor;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(LENS_API, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: POSTS_QUERY,
        variables: { request },
      }),
    });

    if (!response.ok) {
      throw new Error(`Lens API HTTP error: ${response.status}`);
    }

    const result = await response.json() as LensResponse;

    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }

    return {
      items: result.data?.posts?.items || [],
      next: result.data?.posts?.pageInfo?.next,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Lens API: no response after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
