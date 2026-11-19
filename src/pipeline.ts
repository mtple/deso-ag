import { computeEngagementScore } from './formatters/output.js';
import { matchesQuery } from './utils/search.js';
import type { Source, Timeframe, OutputFormat, SortOrder, SearchOptions, Post, FetchResult, AggregateResult } from './types.js';

export function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function similarityRatio(a: string, b: string): number {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (longer.length === 0) return 1;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return matches / longer.length;
}

export function deduplicatePosts(posts: Post[]): Post[] {
  const result: Post[] = [];
  const normalizedCache = new Map<Post, string>();

  for (const post of posts) {
    const normalized = normalizeContent(post.content).slice(0, 200);
    normalizedCache.set(post, normalized);
  }

  for (const post of posts) {
    const normalized = normalizedCache.get(post)!;
    let isDuplicate = false;

    for (let i = 0; i < result.length; i++) {
      const existing = result[i];
      // Only deduplicate across different sources
      if (existing.source === post.source) continue;

      const existingNormalized = normalizedCache.get(existing)!;
      if (similarityRatio(normalized, existingNormalized) > 0.8) {
        // Keep the one with higher engagement
        if (computeEngagementScore(post) > computeEngagementScore(existing)) {
          result[i] = post;
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(post);
    }
  }

  return result;
}

export function mergeResults(results: FetchResult[], sort: SortOrder, query?: string): Post[] {
  const allPosts: Post[] = [];

  for (const result of results) {
    allPosts.push(...result.posts);
  }

  // Deduplicate cross-source
  const deduped = deduplicatePosts(allPosts);

  // Sort
  sortPosts(deduped, sort, query);

  return deduped;
}

export function sortPosts(posts: Post[], sort: SortOrder, query?: string): void {
  switch (sort) {
    case 'recent':
      posts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      break;
    case 'engagement':
      posts.sort((a, b) => {
        const diff = computeEngagementScore(b) - computeEngagementScore(a);
        if (diff !== 0) return diff;
        return b.timestamp.getTime() - a.timestamp.getTime();
      });
      break;
    case 'relevance':
      if (query) {
        posts.sort((a, b) => {
          const aMatches = matchesQuery(a.content, a.tags || [], query);
          const bMatches = matchesQuery(b.content, b.tags || [], query);
          if (aMatches !== bMatches) return aMatches ? -1 : 1;
          const diff = computeEngagementScore(b) - computeEngagementScore(a);
          if (diff !== 0) return diff;
          return b.timestamp.getTime() - a.timestamp.getTime();
        });
      } else {
        // No query, fall back to engagement sort
        posts.sort((a, b) => {
          const diff = computeEngagementScore(b) - computeEngagementScore(a);
          if (diff !== 0) return diff;
          return b.timestamp.getTime() - a.timestamp.getTime();
        });
      }
      break;
  }
}

export function buildMeta(
  results: FetchResult[],
  options: SearchOptions,
  totalPosts: number = results.reduce((sum, r) => sum + r.posts.length, 0),
): AggregateResult['meta'] {
  return {
    query: options.query,
    sources: results.map(r => ({
      name: r.source,
      count: r.posts.length,
      error: r.error,
    })),
    timeframe: options.timeframe,
    fetchedAt: new Date().toISOString(),
    totalPosts,
  };
}

export const SOURCES: readonly Source[] = ['farcaster', 'hypersnap', 'lens', 'nostr', 'bluesky'];
export const TIMEFRAMES: readonly Timeframe[] = ['24h', '48h', 'week'];
export const OUTPUT_FORMATS: readonly OutputFormat[] = ['json', 'markdown', 'summary', 'compact'];
export const SORT_ORDERS: readonly SortOrder[] = ['engagement', 'recent', 'relevance'];

function pickOne<T extends string>(input: string, valid: readonly T[], what: string): T {
  const value = input.trim().toLowerCase() as T;
  if (!valid.includes(value)) {
    throw new Error(`Unknown ${what} "${input}". Choose from: ${valid.join(', ')}`);
  }
  return value;
}

/** Parse a comma-separated source list. Throws on anything it doesn't recognize. */
export function parseSources(input: string): Source[] {
  const requested = input.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (requested.length === 0) {
    throw new Error(`No sources given. Choose from: ${SOURCES.join(', ')}`);
  }

  const unknown = requested.filter(s => !SOURCES.includes(s as Source));
  if (unknown.length > 0) {
    const label = unknown.length === 1 ? 'source' : 'sources';
    throw new Error(`Unknown ${label} ${unknown.map(s => `"${s}"`).join(', ')}. Choose from: ${SOURCES.join(', ')}`);
  }

  return [...new Set(requested)] as Source[];
}

export function parseTimeframe(input: string): Timeframe {
  return pickOne(input, TIMEFRAMES, 'timeframe');
}

export function parseFormat(input: string, allowed: readonly OutputFormat[] = OUTPUT_FORMATS): OutputFormat {
  return pickOne(input, allowed, 'format');
}

export function parseSortOrder(input: string): SortOrder {
  return pickOne(input, SORT_ORDERS, 'sort order');
}

/** Parse a whole number of at least 1. */
export function parsePositiveInt(input: string, what = 'number'): number {
  const value = Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${what} must be a whole number of at least 1 (got "${input}")`);
  }
  return value;
}
