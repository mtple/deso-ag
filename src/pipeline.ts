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

export function buildMeta(results: FetchResult[], options: SearchOptions): AggregateResult['meta'] {
  const totalPosts = results.reduce((sum, r) => sum + r.posts.length, 0);
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

export function parseSources(input: string): Source[] {
  const valid: Source[] = ['farcaster', 'lens', 'nostr'];
  const sources = input.split(',').map(s => s.trim().toLowerCase());

  return sources.filter((s): s is Source => valid.includes(s as Source));
}

export function parseTimeframe(input: string): Timeframe {
  const valid: Timeframe[] = ['24h', '48h', 'week'];
  const tf = input.toLowerCase() as Timeframe;

  return valid.includes(tf) ? tf : '24h';
}

export function parseFormat(input: string): OutputFormat {
  const valid: OutputFormat[] = ['json', 'markdown', 'summary', 'compact'];
  const fmt = input.toLowerCase() as OutputFormat;

  return valid.includes(fmt) ? fmt : 'markdown';
}

export function parseSortOrder(input: string): SortOrder {
  const valid: SortOrder[] = ['engagement', 'recent', 'relevance'];
  const sort = input.toLowerCase() as SortOrder;

  return valid.includes(sort) ? sort : 'engagement';
}
