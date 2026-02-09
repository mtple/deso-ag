import { fetchFarcaster } from './fetchers/farcaster.js';
import { fetchLens } from './fetchers/lens.js';
import { fetchNostr } from './fetchers/nostr.js';
import { fetchBluesky } from './fetchers/bluesky.js';
import { computeEngagementScore } from './formatters/output.js';
import { deduplicatePosts, sortPosts } from './pipeline.js';
import { extractTermsBySource } from './terms.js';
import type { SearchOptions, Post, FetchResult, AggregateResult, SortOrder, TermsResult } from './types.js';

// Re-export types and utilities
export { formatOutput, computeEngagementScore, formatTermsSummary } from './formatters/output.js';
export { matchesQuery } from './utils/search.js';
export { extractTerms, extractTermsBySource, tokenize } from './terms.js';
export { fetchFarcaster } from './fetchers/farcaster.js';
export { fetchLens } from './fetchers/lens.js';
export { fetchNostr } from './fetchers/nostr.js';
export { fetchBluesky } from './fetchers/bluesky.js';
export type { Source, Timeframe, OutputFormat, SortOrder, Post, SearchOptions, FetchResult, AggregateResult, Term, SourceTerms, TermsResult } from './types.js';

/**
 * Aggregate posts from decentralized social networks.
 * This is the primary entry point for programmatic/agent usage.
 */
export async function aggregate(options: SearchOptions): Promise<AggregateResult> {
  const sort: SortOrder = options.sort || (options.query ? 'relevance' : 'engagement');

  // Fetch from all requested sources in parallel
  const fetchers: Promise<FetchResult>[] = [];
  for (const source of options.sources) {
    switch (source) {
      case 'farcaster':
        fetchers.push(fetchFarcaster(options));
        break;
      case 'lens':
        fetchers.push(fetchLens(options));
        break;
      case 'nostr':
        fetchers.push(fetchNostr(options));
        break;
      case 'bluesky':
        fetchers.push(fetchBluesky(options));
        break;
    }
  }

  const results = await Promise.all(fetchers);

  // Merge all posts
  const allPosts: Post[] = [];
  for (const result of results) {
    allPosts.push(...result.posts);
  }

  // Deduplicate cross-source
  const deduped = deduplicatePosts(allPosts);

  // Sort
  sortPosts(deduped, sort, options.query);

  // Build meta
  const meta: AggregateResult['meta'] = {
    query: options.query,
    sources: results.map(r => ({
      name: r.source,
      count: r.posts.length,
      error: r.error,
    })),
    timeframe: options.timeframe,
    fetchedAt: new Date().toISOString(),
    totalPosts: deduped.length,
  };

  return { posts: deduped, meta };
}

/**
 * Extract top discussion terms from decentralized social networks.
 * Fetches posts and analyzes content for engagement-weighted term frequency.
 */
export async function terms(
  options: SearchOptions,
  topN: number = 3,
): Promise<TermsResult> {
  const { posts } = await aggregate(options);
  return extractTermsBySource(posts, topN, options.timeframe);
}
