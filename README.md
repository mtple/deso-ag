# deso-ag

**Decentralized Social Aggregator** - A CLI tool and library for aggregating posts from decentralized social protocols.

Search and view content across **Farcaster**, **Lens**, and **Nostr** from your terminal or programmatically from your agent.

## Setup

```bash
git clone https://github.com/sphairetra/deso-ag
cd deso-ag
pnpm install
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEYNAR_API_KEY` | Yes (for Farcaster) | Neynar API key. Get one free at [neynar.com](https://neynar.com) |

Lens and Nostr work without any keys.

Add the key to your shell profile so it persists across sessions:

```bash
# Add to ~/.zshrc or ~/.bashrc
export NEYNAR_API_KEY=your-key-here
```

Without the key, Farcaster is skipped and other sources still work normally.

## Commands

### `search [query]`

Search for posts across networks.

```bash
pnpm dev search "ethereum"
pnpm dev search "AI" --sources nostr
pnpm dev search --channel dev --sources farcaster
```

Multi-word queries use AND semantics (all terms must match):

```bash
pnpm dev search "AI crypto"       # posts must contain both "AI" and "crypto"
pnpm dev search "ethereum layer2"
```

### `trending`

Get trending posts from all networks.

```bash
pnpm dev trending
pnpm dev trending --sources farcaster,lens
pnpm dev trending --format json --limit 50
```

### `terms`

Extract top discussion terms from posts via engagement-weighted frequency analysis.

```bash
pnpm dev terms                              # top 3 terms per platform, last 24h
pnpm dev terms -n 5 -s farcaster -t week    # top 5, Farcaster only, last week
pnpm dev terms -f json                      # machine-readable output
```

### `channels`

Browse popular Farcaster channels.

```bash
pnpm dev channels
pnpm dev channels --limit 50
```

## Options

All commands accept the following options (except where noted):

| Option | Description | Values | Default |
|--------|-------------|--------|---------|
| `-s, --sources` | Networks to query | `farcaster`, `lens`, `nostr` (comma-separated) | `farcaster,lens,nostr` (all) |
| `-t, --timeframe` | Time range for posts | `24h`, `48h`, `week` | `24h` |
| `-c, --channel` | Filter by channel | Any channel ID (Farcaster only) | none |
| `-f, --format` | Output format | `json`, `markdown`, `summary`, `compact` | `markdown` (search), `summary` (trending) |
| `-l, --limit` | Max posts per source | Any positive integer | `25` |
| `-o, --sort` | Sort order | `engagement`, `recent`, `relevance` | `relevance` (search), `engagement` (trending) |
| `-n, --top` | Top terms per source | Any positive integer (terms command only) | `3` |

### Output Formats

- **`markdown`** - Human-readable with headers, author info, and engagement stats. Default for `search`.
- **`summary`** - Condensed overview with post counts and top content. Default for `trending`.
- **`json`** - Raw JSON array of post objects. Good for piping to other tools.
- **`compact`** - Single JSON object with metadata envelope, engagement scores, and full content. Designed for AI agents.

### Sort Orders

- **`engagement`** - By score (`likes + reposts*2 + replies`). Best for discovering high-signal content. Default for `trending`.
- **`recent`** - By timestamp descending. Best for monitoring.
- **`relevance`** - Query-matching posts first, then by engagement. Default for `search`.

## Agent Usage

deso-ag is designed for consumption by AI agents doing research across decentralized social networks.

### Compact Output Format

The `compact` format returns a single JSON object with a metadata envelope, pre-computed engagement scores, full untruncated content, and source health info:

```bash
pnpm dev trending -f compact -l 10
pnpm dev search "AI agents" -f compact -l 10
```

Output shape:

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

Individual fetchers and utilities are also exported:

```typescript
import { fetchFarcaster, fetchLens, fetchNostr, computeEngagementScore, matchesQuery, extractTerms } from 'deso-ag';
```

## Examples

```bash
# Get a quick summary of trending content
pnpm dev trending -f summary -l 20

# Agent-optimized compact output sorted by engagement
pnpm dev trending -f compact -o engagement -l 10

# Search for AI discussions on Lens only
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

| Network | API | Auth |
|---------|-----|------|
| **Farcaster** | [Neynar API](https://neynar.com) - trending feed and full-text search | `NEYNAR_API_KEY` required |
| **Lens** | [Lens V3 GraphQL API](https://api.lens.xyz) - server-side search, recent posts | None |
| **Nostr** | [nostr.wine trending API](https://docs.nostr.wine/api/trending) + public relays (relay.damus.io, nos.lol, relay.snort.social) | None |

All networks return engagement stats (likes, reposts, replies) and support timeframe filtering.

## Limitations

- **Farcaster**: Requires `NEYNAR_API_KEY`. Without it, Farcaster is skipped.
- **Nostr**: Relay responses can be slow or inconsistent depending on network conditions.
- **Rate limits**: All APIs have rate limits. For heavy usage, consider running your own infrastructure.

## Development

```bash
pnpm build    # Build for production
pnpm test     # Run tests
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
