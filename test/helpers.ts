import type { Post, FetchResult } from '../src/types.js';

/**
 * Create a test post with sensible defaults.
 * Override any field by passing partial options.
 */
export function makePost(overrides: Partial<Post> & { id?: string; source?: Post['source'] } = {}): Post {
  return {
    id: overrides.id ?? 'post-1',
    source: overrides.source ?? 'farcaster',
    author: overrides.author ?? {
      username: 'testuser',
      displayName: 'Test User',
      profileUrl: 'https://example.com/testuser',
    },
    content: overrides.content ?? 'This is a test post about ethereum and crypto',
    timestamp: overrides.timestamp ?? new Date('2025-01-15T12:00:00Z'),
    url: overrides.url ?? 'https://example.com/post/1',
    engagement: overrides.engagement ?? {
      likes: 10,
      reposts: 5,
      replies: 3,
    },
    tags: overrides.tags ?? [],
    channel: overrides.channel,
  };
}

/**
 * Create a FetchResult with sensible defaults.
 */
export function makeFetchResult(
  source: Post['source'],
  posts: Post[],
  error?: string,
): FetchResult {
  return { posts, source, error };
}
