# deso-ag

**Decentralized Social Aggregator** - A CLI tool and library for aggregating posts from decentralized social protocols.

Search and view content across **Farcaster**, **Lens**, and **Nostr** from your terminal or programmatically from your agent. No API keys required.

## Features

- **Search** across all three protocols simultaneously
- **Trending** posts from popular channels and relays
- **Terms** — extract top discussion terms per platform via engagement-weighted frequency analysis
- **Browse** Farcaster channels
- **Multiple output formats**: JSON, Markdown, Summary, Compact (agent-optimized)
- **Sorting**: by engagement, recency, or relevance
- **Multi-word search** with AND semantics
- **Cross-source deduplication**
- **Library API** via `aggregate()` for programmatic use
- **Zero configuration** - works out of the box
- **No API keys required** - uses free public endpoints

## Installation

```bash
git clone https://github.com/sphairetra/deso-ag
cd deso-ag
pnpm install
```

## Usage

### Trending Posts

Get trending posts from all networks:

```bash
pnpm dev trending
pnpm dev trending --sources farcaster,lens
pnpm dev trending --format json --limit 50
```

### Search

Search for posts across networks:

```bash
pnpm dev search "ethereum"
pnpm dev search "AI" --sources nostr
pnpm dev search --channel dev --sources farcaster
```

Multi-word queries use AND semantics (all terms must match):

```bash
pnpm dev search "AI crypto"
pnpm dev search "ethereum layer2"
```

### Terms

Extract top discussion terms from posts:

```bash
# Top 3 terms per platform from the last 24h
pnpm dev terms

# Top 5 terms, only Farcaster, last week
pnpm dev terms -n 5 -s farcaster -t week

# Machine-readable for agents
pnpm dev terms -f compact
pnpm dev terms -f json
```

### List Channels

Browse popular Farcaster channels:

```bash
pnpm dev channels
pnpm dev channels --limit 50
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --sources` | Networks to query (farcaster,lens,nostr) | all |
| `-t, --timeframe` | Time range (24h, 48h, week) | 24h |
| `-c, --channel` | Filter by channel (Farcaster only) | — |
| `-f, --format` | Output format (json, markdown, summary, compact) | markdown |
| `-l, --limit` | Max posts to fetch per source (e.g. `-l 10` fetches up to 10 posts from each network) | 25 |
| `-o, --sort` | Sort order (engagement, recent, relevance) | relevance (search) / engagement (trending) |
| `-n, --top` | Number of top terms to return per source (terms command only) | 3 |

## Agent Usage

deso-ag is designed for consumption by AI agents doing research across decentralized social networks.

### Compact Output Format

The `compact` format returns a single JSON object with a metadata envelope, pre-computed engagement scores, full untruncated content, and source health info. Use it when your agent needs structured, machine-readable output:

```bash
pnpm dev trending -f compact -l 10
pnpm dev search "AI agents" -f compact -l 10
```

The output shape:

```json
{
  "meta": {
    "query": "AI agents",
    "totalPosts": 42,
    "sources": [
      {"name": "farcaster", "count": 15},
      {"name": "lens", "count": 12},
      {"name": "nostr", "count": 15}
    ],
    "timeframe": "24h",
    "fetchedAt": "2025-01-01T00:00:00.000Z"
  },
  "posts": [
    {
      "id": "...",
      "source": "farcaster",
      "author": "dwr",
      "content": "full untruncated content...",
      "timestamp": "2025-01-01T00:00:00.000Z",
      "url": "https://...",
      "score": 523,
      "engagement": {"likes": 400, "reposts": 50, "replies": 23},
      "tags": []
    }
  ]
}
```

### Sort Order

Use `--sort` (`-o`) to control post ordering:

- `engagement` - by score (`likes + reposts*2 + replies`), best for discovering high-signal content
- `recent` - by timestamp descending, best for monitoring
- `relevance` - query-matching posts first, then by engagement (search default)

### Library Import

For agents that run in Node.js, import `aggregate()` directly instead of shelling out:

```typescript
import { aggregate } from 'deso-ag';

const result = await aggregate({
  sources: ['farcaster', 'lens', 'nostr'],
  timeframe: '24h',
  query: 'AI agents',
  limit: 20,
  sort: 'relevance',
});

console.log(result.meta.totalPosts);
for (const post of result.posts) {
  console.log(`[${post.source}] @${post.author.username}: ${post.content.slice(0, 100)}`);
}
```

The `terms()` function extracts top discussion terms:

```typescript
import { terms } from 'deso-ag';

const result = await terms({
  sources: ['farcaster', 'nostr'],
  timeframe: '24h',
  limit: 20,
}, 5); // top 5 terms

for (const st of result.bySource) {
  console.log(`${st.source}: ${st.terms.map(t => t.token).join(', ')}`);
}
```

Individual fetchers and utilities are also exported for granular use:

```typescript
import { fetchFarcaster, fetchLens, fetchNostr, computeEngagementScore, matchesQuery, extractTerms } from 'deso-ag';
```

## Examples

```bash
# Get a quick summary of trending content
pnpm dev trending -f summary -l 20

# Agent-optimized compact output sorted by engagement
pnpm dev trending -f compact -o engagement -l 10

# Search for AI discussions on Lens
pnpm dev search "AI" -s lens -f json

# Multi-word search with compact output
pnpm dev search "AI crypto" -f compact -l 10

# Browse the /dev channel on Farcaster
pnpm dev search --channel dev -s farcaster

# Export trending Nostr posts as JSON
pnpm dev trending -s nostr -f json > nostr-trending.json

# Sort search results by recency
pnpm dev search "ethereum" -o recent -f json -l 5

# Top 5 terms across all networks this week
pnpm dev terms -n 5 -t week

# Terms from Farcaster and Nostr as JSON
pnpm dev terms -f json -s farcaster,nostr -l 10
```

## Supported Networks

### Farcaster
- Uses the [Farcaster Client API](https://api.farcaster.xyz) (`v2/casts`) for real-time data
- Queries popular accounts (dwr, v, jessepollak, vitalik.eth, etc.) in parallel
- Returns full engagement stats (likes, recasts, replies)
- Timeframe filtering (24h, 48h, week)

### Lens
- Uses [Lens V3 GraphQL API](https://api.lens.xyz)
- Server-side search filtering via `searchQuery` when a query is provided
- Fetches recent posts with engagement stats
- No API key needed

### Nostr
- Uses [nostr.wine trending API](https://docs.nostr.wine/api/trending) for popular posts with engagement stats
- Fetches full event content from public relays (relay.damus.io, nos.lol, relay.snort.social)
- Fetches profiles for author resolution
- Hashtag extraction from event tags

## Limitations

- **Farcaster**: Trending results are sourced from a curated list of popular accounts. For broader coverage, consider using [Neynar](https://neynar.com).
- **Nostr**: Relay responses can be slow or inconsistent depending on network conditions.
- **Rate limits**: All APIs have rate limits. For heavy usage, consider running your own infrastructure.

## Development

```bash
# Build for production
pnpm build

# Test
pnpm test
```

## Tech Stack

- TypeScript
- Commander.js for CLI
- nostr-tools for Nostr protocol
- Native fetch for HTTP requests

## License

Apache 2.0

## Author

[@mattlee.eth](https://farcaster.xyz/mattlee.eth)
