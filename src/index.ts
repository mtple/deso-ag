#!/usr/bin/env node

import { Command } from 'commander';
import { fetchFarcaster } from './fetchers/farcaster.js';
import { fetchLens } from './fetchers/lens.js';
import { fetchNostr } from './fetchers/nostr.js';
import { formatOutput } from './formatters/output.js';
import type { Source, Timeframe, OutputFormat, SearchOptions, Post, FetchResult } from './types.js';

// Polyfill WebSocket for Node.js (needed for Nostr)
import 'websocket-polyfill';

const program = new Command();

program
  .name('deso-ag')
  .description('CLI tool for aggregating posts from decentralized social protocols')
  .version('1.0.0');

program
  .command('search [query]')
  .description('Search for posts across decentralized social networks')
  .option('-s, --sources <sources>', 'Comma-separated list of sources (farcaster,lens,nostr)', 'farcaster,lens,nostr')
  .option('-t, --timeframe <timeframe>', 'Time range: 24h, 48h, week', '24h')
  .option('-c, --channel <channel>', 'Filter by channel (Farcaster only)')
  .option('-f, --format <format>', 'Output format: json, markdown, summary', 'markdown')
  .option('-l, --limit <limit>', 'Maximum posts per source', '25')
  .action(async (query: string | undefined, options) => {
    const sources = parseSources(options.sources);
    const timeframe = parseTimeframe(options.timeframe);
    const format = parseFormat(options.format);
    const limit = parseInt(options.limit, 10) || 25;

    const searchOptions: SearchOptions = {
      query,
      sources,
      timeframe,
      channel: options.channel,
      limit,
    };

    const queryStr = query || 'all';
    console.error(`\n🔍 Searching ${sources.join(', ')} for "${queryStr}" (${timeframe})...\n`);

    const results = await fetchFromSources(searchOptions);
    
    // Merge and sort all posts
    const allPosts = mergeResults(results);
    
    // Show any errors
    for (const result of results) {
      if (result.error) {
        console.error(`⚠️  ${result.source}: ${result.error}`);
      }
    }

    if (allPosts.length === 0) {
      console.error('No posts found. Try different search terms or sources.\n');
    }

    // Output results
    console.log(formatOutput(allPosts, format));
  });

program
  .command('trending')
  .description('Get trending posts from decentralized social networks')
  .option('-s, --sources <sources>', 'Comma-separated list of sources (farcaster,lens,nostr)', 'farcaster,lens,nostr')
  .option('-t, --timeframe <timeframe>', 'Time range: 24h, 48h, week', '24h')
  .option('-f, --format <format>', 'Output format: json, markdown, summary', 'summary')
  .option('-l, --limit <limit>', 'Maximum posts per source', '25')
  .action(async (options) => {
    const sources = parseSources(options.sources);
    const timeframe = parseTimeframe(options.timeframe);
    const format = parseFormat(options.format);
    const limit = parseInt(options.limit, 10) || 25;

    const searchOptions: SearchOptions = {
      sources,
      timeframe,
      limit,
    };

    console.error(`\n📈 Fetching trending from ${sources.join(', ')} (${timeframe})...\n`);

    const results = await fetchFromSources(searchOptions);
    
    // Merge and sort all posts
    const allPosts = mergeResults(results);
    
    // Show any errors
    for (const result of results) {
      if (result.error) {
        console.error(`⚠️  ${result.source}: ${result.error}`);
      }
    }

    if (allPosts.length === 0) {
      console.error('No posts found.\n');
    }

    // Output results
    console.log(formatOutput(allPosts, format));
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
    }
  }

  return Promise.all(fetchers);
}

function mergeResults(results: FetchResult[]): Post[] {
  const allPosts: Post[] = [];
  
  for (const result of results) {
    allPosts.push(...result.posts);
  }

  // Sort by timestamp descending (newest first)
  allPosts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  
  return allPosts;
}

function parseSources(input: string): Source[] {
  const valid: Source[] = ['farcaster', 'lens', 'nostr'];
  const sources = input.split(',').map(s => s.trim().toLowerCase());
  
  return sources.filter((s): s is Source => valid.includes(s as Source));
}

function parseTimeframe(input: string): Timeframe {
  const valid: Timeframe[] = ['24h', '48h', 'week'];
  const tf = input.toLowerCase() as Timeframe;
  
  return valid.includes(tf) ? tf : '24h';
}

function parseFormat(input: string): OutputFormat {
  const valid: OutputFormat[] = ['json', 'markdown', 'summary'];
  const fmt = input.toLowerCase() as OutputFormat;
  
  return valid.includes(fmt) ? fmt : 'markdown';
}

program.parse();
