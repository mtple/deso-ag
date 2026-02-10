#!/usr/bin/env node

import { Command } from 'commander';
import { fetchFarcaster } from './fetchers/farcaster.js';
import { fetchLens } from './fetchers/lens.js';
import { fetchNostr } from './fetchers/nostr.js';
import { fetchBluesky } from './fetchers/bluesky.js';
import { formatOutput, formatTermsSummary } from './formatters/output.js';
import {
  mergeResults,
  buildMeta,
  parseSources,
  parseTimeframe,
  parseFormat,
  parseSortOrder,
} from './pipeline.js';
import { extractTermsBySource } from './terms.js';
import type { SearchOptions, FetchResult } from './types.js';

// Polyfill WebSocket for Node.js (needed for Nostr)
import 'websocket-polyfill';

const program = new Command();

program
  .name('deso-ag')
  .description('CLI tool for aggregating posts from decentralized social protocols')
  .version('1.0.2');

program
  .command('search [query]')
  .description('Search for posts across decentralized social networks')
  .option('-s, --sources <sources>', 'Comma-separated list of sources (farcaster,lens,nostr,bluesky)', 'farcaster,lens,nostr,bluesky')
  .option('-t, --timeframe <timeframe>', 'Time range: 24h, 48h, week', '24h')
  .option('-c, --channel <channel>', 'Filter by channel (Farcaster only)')
  .option('-f, --format <format>', 'Output format: json, markdown, summary, compact', 'markdown')
  .option('-l, --limit <limit>', 'Maximum posts per source', '25')
  .option('-o, --sort <sort>', 'Sort order: engagement, recent, relevance', 'relevance')
  .action(async (query: string | undefined, options) => {
    const sources = parseSources(options.sources);
    const timeframe = parseTimeframe(options.timeframe);
    const format = parseFormat(options.format);
    const limit = parseInt(options.limit, 10) || 25;
    const sort = parseSortOrder(options.sort);

    const searchOptions: SearchOptions = {
      query,
      sources,
      timeframe,
      channel: options.channel,
      limit,
      sort,
    };

    const queryStr = query || 'all';
    console.error(`\n🔍 Searching ${sources.join(', ')} for "${queryStr}" (${timeframe})...\n`);

    const results = await fetchFromSources(searchOptions);

    // Merge, deduplicate, and sort all posts
    const allPosts = mergeResults(results, sort, query);

    // Build meta for compact format
    const meta = buildMeta(results, searchOptions);

    // Show any errors
    for (const result of results) {
      if (result.error) {
        console.error(`⚠️  ${result.source}: ${result.error}`);
      }
    }

    if (allPosts.length === 0) {
      console.error('No posts found. Try different search terms or sources.\n');
    }

    // Extract terms for compact format
    const termsResult = format === 'compact' ? extractTermsBySource(allPosts, 3, timeframe) : undefined;

    // Output results
    console.log(formatOutput(allPosts, format, meta, termsResult));
  });

program
  .command('trending')
  .description('Get trending posts from decentralized social networks')
  .option('-s, --sources <sources>', 'Comma-separated list of sources (farcaster,lens,nostr,bluesky)', 'farcaster,lens,nostr,bluesky')
  .option('-t, --timeframe <timeframe>', 'Time range: 24h, 48h, week', '24h')
  .option('-f, --format <format>', 'Output format: json, markdown, summary, compact', 'summary')
  .option('-l, --limit <limit>', 'Maximum posts per source', '25')
  .option('-o, --sort <sort>', 'Sort order: engagement, recent, relevance', 'engagement')
  .action(async (options) => {
    const sources = parseSources(options.sources);
    const timeframe = parseTimeframe(options.timeframe);
    const format = parseFormat(options.format);
    const limit = parseInt(options.limit, 10) || 25;
    const sort = parseSortOrder(options.sort);

    const searchOptions: SearchOptions = {
      sources,
      timeframe,
      limit,
      sort,
    };

    console.error(`\n📈 Fetching trending from ${sources.join(', ')} (${timeframe})...\n`);

    const results = await fetchFromSources(searchOptions);

    // Merge, deduplicate, and sort all posts
    const allPosts = mergeResults(results, sort);

    // Build meta for compact format
    const meta = buildMeta(results, searchOptions);

    // Show any errors
    for (const result of results) {
      if (result.error) {
        console.error(`⚠️  ${result.source}: ${result.error}`);
      }
    }

    if (allPosts.length === 0) {
      console.error('No posts found.\n');
    }

    // Extract terms for compact format
    const termsResult = format === 'compact' ? extractTermsBySource(allPosts, 3, timeframe) : undefined;

    // Output results
    console.log(formatOutput(allPosts, format, meta, termsResult));
  });

program
  .command('channels')
  .description('List popular Farcaster channels')
  .option('-l, --limit <limit>', 'Maximum channels to show', '20')
  .action(async (options) => {
    const limit = parseInt(options.limit, 10) || 20;

    console.error('\n📺 Popular Farcaster channels:\n');

    try {
      const response = await fetch('https://api.farcaster.xyz/v2/all-channels');
      if (!response.ok) throw new Error('Failed to fetch channels');

      const data = await response.json() as { result?: { channels?: Array<{ id: string; name: string; followerCount: number; description?: string }> } };
      const channels = data.result?.channels || [];

      // Sort by follower count
      const sorted = channels.sort((a, b) => (b.followerCount || 0) - (a.followerCount || 0)).slice(0, limit);

      for (const ch of sorted) {
        const desc = ch.description ? ch.description.slice(0, 60) + (ch.description.length > 60 ? '...' : '') : '';
        console.log(`/${ch.id} (${(ch.followerCount || 0).toLocaleString()} followers)`);
        if (desc) console.log(`  ${desc}`);
        console.log('');
      }
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    }
  });

program
  .command('terms')
  .description('Extract top discussion terms from posts')
  .option('-s, --sources <sources>', 'Comma-separated list of sources (farcaster,lens,nostr,bluesky)', 'farcaster,lens,nostr,bluesky')
  .option('-t, --timeframe <timeframe>', 'Time range: 24h, 48h, week', '24h')
  .option('-n, --top <count>', 'Number of top terms per source', '3')
  .option('-f, --format <format>', 'Output format: json, summary, compact', 'summary')
  .option('-l, --limit <limit>', 'Maximum posts per source', '25')
  .action(async (options) => {
    const sources = parseSources(options.sources);
    const timeframe = parseTimeframe(options.timeframe);
    const format = parseFormat(options.format);
    const limit = parseInt(options.limit, 10) || 25;
    const topN = parseInt(options.top, 10) || 3;

    const searchOptions: SearchOptions = {
      sources,
      timeframe,
      limit,
      sort: 'engagement',
    };

    console.error(`\n📊 Analyzing terms from ${sources.join(', ')} (${timeframe})...\n`);

    const results = await fetchFromSources(searchOptions);

    for (const result of results) {
      if (result.error) {
        console.error(`⚠️  ${result.source}: ${result.error}`);
      }
    }

    const allPosts = mergeResults(results, 'engagement');

    if (allPosts.length === 0) {
      console.error('No posts found to analyze.\n');
    }

    const termsResult = extractTermsBySource(allPosts, topN, timeframe);

    switch (format) {
      case 'json':
        console.log(JSON.stringify(termsResult, null, 2));
        break;
      case 'compact':
        console.log(JSON.stringify(termsResult));
        break;
      default:
        console.log(formatTermsSummary(termsResult));
        break;
    }
  });

async function fetchFromSources(options: SearchOptions): Promise<FetchResult[]> {
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

  return Promise.all(fetchers);
}

program.parse();
