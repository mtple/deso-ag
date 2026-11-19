import { fetchFarcaster } from './fetchers/farcaster.js';
import { fetchHypersnap } from './fetchers/hypersnap.js';
import { fetchLens } from './fetchers/lens.js';
import { fetchNostr } from './fetchers/nostr.js';
import { fetchBluesky } from './fetchers/bluesky.js';
import { mergeResults, buildMeta } from './pipeline.js';
import { extractTermsBySource } from './terms.js';
import type { Source, SearchOptions, FetchResult, AggregateResult, SortOrder, TermsResult } from './types.js';

// Re-export types and utilities
export { formatOutput, computeEngagementScore, formatTermsSummary } from './formatters/output.js';
export { matchesQuery } from './utils/search.js';
export { extractTerms, extractTermsBySource, tokenize } from './terms.js';
export { fetchFarcaster } from './fetchers/farcaster.js';
export { fetchHypersnap } from './fetchers/hypersnap.js';
export { fetchLens } from './fetchers/lens.js';
export { fetchNostr } from './fetchers/nostr.js';
export { fetchBluesky } from './fetchers/bluesky.js';
export { fetchChannels } from './channels.js';
export type { Channel, ChannelsResult } from './channels.js';
export { SOURCES, TIMEFRAMES, OUTPUT_FORMATS, SORT_ORDERS } from './pipeline.js';
export type { Source, Timeframe, OutputFormat, SortOrder, Post, SearchOptions, FetchResult, AggregateResult, Term, SourceTerms, TermsResult } from './types.js';

const FETCHERS: Record<Source, (options: SearchOptions) => Promise<FetchResult>> = {
  farcaster: fetchFarcaster,
  hypersnap: fetchHypersnap,
  lens: fetchLens,
  nostr: fetchNostr,
  bluesky: fetchBluesky,
};

/**
 * Aggregate posts from decentralized social networks.
 * This is the primary entry point for programmatic/agent usage, and what the CLI runs.
 */
export async function aggregate(options: SearchOptions): Promise<AggregateResult> {
  const sort: SortOrder = options.sort || (options.query ? 'relevance' : 'engagement');

  // Fetch from all requested sources in parallel
  const results = await Promise.all(
    [...new Set(options.sources)].map(source => FETCHERS[source](options)),
  );

  // Merge, deduplicate across sources, and sort
  const posts = mergeResults(results, sort, options.query);

  return { posts, meta: buildMeta(results, options, posts.length) };
}

/**
 * Extract top discussion terms from decentralized social networks.
 * Fetches posts and analyzes content for engagement-weighted term frequency.
 */
export async function terms(
  options: SearchOptions,
  topN: number = 3,
): Promise<TermsResult> {
  const { posts } = await aggregate({ ...options, sort: 'engagement' });
  return extractTermsBySource(posts, topN, options.timeframe);
}
