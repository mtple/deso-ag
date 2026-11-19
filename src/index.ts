#!/usr/bin/env node

import dotenv from 'dotenv';
import { createRequire } from 'node:module';
import { Command, InvalidArgumentError, Option } from 'commander';
import { aggregate } from './lib.js';
import { fetchChannels } from './channels.js';
import { formatOutput, formatTermsSummary } from './formatters/output.js';
import {
  SOURCES,
  parseSources,
  parseTimeframe,
  parseFormat,
  parseSortOrder,
  parsePositiveInt,
} from './pipeline.js';
import { extractTermsBySource } from './terms.js';
import type { AggregateResult, OutputFormat, SearchOptions } from './types.js';

// Load .env without printing anything: stdout carries JSON for agents
dotenv.config({ quiet: true });

// package.json sits one level up from both src/ and dist/
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

/** Turn a parser's error into commander's "invalid argument" message. */
function strict<T>(parse: (value: string) => T): (value: string) => T {
  return (value: string) => {
    try {
      return parse(value);
    } catch (error) {
      throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
    }
  };
}

const ALL_SOURCES = SOURCES.join(',');
const sourcesOption = strict(parseSources);
const timeframeOption = strict(parseTimeframe);
const sortOption = strict(parseSortOrder);
const limitOption = strict((v: string) => parsePositiveInt(v, 'limit'));
const postFormatOption = strict((v: string) => parseFormat(v));
const termsFormatOption = strict((v: string) => parseFormat(v, ['json', 'summary', 'compact']));
const channelsFormatOption = strict((v: string) => parseFormat(v, ['json', 'summary']));

function sourcesFlag(): Option {
  return new Option('-s, --sources <sources>', `Comma-separated list of sources (${ALL_SOURCES})`)
    .argParser(sourcesOption)
    .default([...SOURCES], 'all');
}

function reportSourceErrors(meta: AggregateResult['meta']): void {
  for (const source of meta.sources) {
    if (source.error) {
      console.error(`⚠️  ${source.name}: ${source.error}`);
    }
  }
}

async function runPosts(searchOptions: SearchOptions, format: OutputFormat, emptyMessage: string): Promise<void> {
  const { posts, meta } = await aggregate(searchOptions);

  reportSourceErrors(meta);
  if (posts.length === 0) {
    console.error(emptyMessage);
  }

  // Extract terms for compact format
  const termsResult = format === 'compact' ? extractTermsBySource(posts, 3, searchOptions.timeframe) : undefined;

  console.log(formatOutput(posts, format, meta, termsResult));
}

const program = new Command();

program
  .name('deso-ag')
  .description('CLI tool for aggregating posts from decentralized social protocols')
  .version(version);

program
  .command('search [query]')
  .description('Search for posts across decentralized social networks')
  .addOption(sourcesFlag())
  .option('-t, --timeframe <timeframe>', 'Time range: 24h, 48h, week', timeframeOption, '24h')
  .option('-c, --channel <channel>', 'Filter by channel (Farcaster and Hypersnap)')
  .option('-f, --format <format>', 'Output format: json, markdown, summary, compact', postFormatOption, 'markdown')
  .option('-l, --limit <limit>', 'Maximum posts per source', limitOption, 25)
  .option('-o, --sort <sort>', 'Sort order: engagement, recent, relevance', sortOption, 'relevance')
  .action(async (query: string | undefined, options) => {
    const searchOptions: SearchOptions = {
      query,
      sources: options.sources,
      timeframe: options.timeframe,
      channel: options.channel,
      limit: options.limit,
      sort: options.sort,
    };

    console.error(`\n🔍 Searching ${searchOptions.sources.join(', ')} for "${query || 'all'}" (${searchOptions.timeframe})...\n`);

    await runPosts(searchOptions, options.format, 'No posts found. Try different search terms or sources.\n');
  });

program
  .command('trending')
  .description('Get trending posts from decentralized social networks')
  .addOption(sourcesFlag())
  .option('-t, --timeframe <timeframe>', 'Time range: 24h, 48h, week', timeframeOption, '24h')
  .option('-f, --format <format>', 'Output format: json, markdown, summary, compact', postFormatOption, 'summary')
  .option('-l, --limit <limit>', 'Maximum posts per source', limitOption, 25)
  .option('-o, --sort <sort>', 'Sort order: engagement, recent, relevance', sortOption, 'engagement')
  .action(async (options) => {
    const searchOptions: SearchOptions = {
      sources: options.sources,
      timeframe: options.timeframe,
      limit: options.limit,
      sort: options.sort,
    };

    console.error(`\n📈 Fetching trending from ${searchOptions.sources.join(', ')} (${searchOptions.timeframe})...\n`);

    await runPosts(searchOptions, options.format, 'No posts found.\n');
  });

program
  .command('channels')
  .description('List popular Farcaster channels (falls back to a Hypersnap node)')
  .option('-l, --limit <limit>', 'Maximum channels to show', limitOption, 20)
  .option('-f, --format <format>', 'Output format: json, summary', channelsFormatOption, 'summary')
  .action(async (options) => {
    try {
      const result = await fetchChannels(options.limit);

      if (result.source === 'hypersnap') {
        console.error(`⚠️  Farcaster channel list unavailable (${result.fallbackReason}); showing Hypersnap's instead.`);
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(result.channels, null, 2));
        return;
      }

      console.error(`\n📺 Popular ${result.source === 'hypersnap' ? 'Hypersnap' : 'Farcaster'} channels:\n`);
      for (const ch of result.channels) {
        const desc = ch.description ? ch.description.slice(0, 60) + (ch.description.length > 60 ? '...' : '') : '';
        console.log(`/${ch.id} (${ch.followerCount.toLocaleString()} followers)`);
        if (desc) console.log(`  ${desc}`);
        console.log('');
      }
    } catch (error) {
      console.error(`Failed to fetch channels: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  });

program
  .command('terms')
  .description('Extract top discussion terms from posts')
  .addOption(sourcesFlag())
  .option('-t, --timeframe <timeframe>', 'Time range: 24h, 48h, week', timeframeOption, '24h')
  .option('-n, --top <count>', 'Number of top terms per source', strict((v: string) => parsePositiveInt(v, 'top')), 3)
  .option('-f, --format <format>', 'Output format: json, summary, compact', termsFormatOption, 'summary')
  .option('-l, --limit <limit>', 'Maximum posts per source', limitOption, 25)
  .action(async (options) => {
    const searchOptions: SearchOptions = {
      sources: options.sources,
      timeframe: options.timeframe,
      limit: options.limit,
      sort: 'engagement',
    };

    console.error(`\n📊 Analyzing terms from ${searchOptions.sources.join(', ')} (${searchOptions.timeframe})...\n`);

    const { posts, meta } = await aggregate(searchOptions);
    reportSourceErrors(meta);

    if (posts.length === 0) {
      console.error('No posts found to analyze.\n');
    }

    const termsResult = extractTermsBySource(posts, options.top, searchOptions.timeframe);

    switch (options.format as OutputFormat) {
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

// Exit explicitly: open relay sockets and keep-alive connections would otherwise hold the process
program.parseAsync().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
