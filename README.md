# deso-ag

**Decentralized Social Aggregator** - A CLI tool and library for aggregating posts from decentralized social protocols.

Search and view content across **Farcaster**, **Hypersnap**, **Lens**, **Nostr**, and **Bluesky** from your terminal or programmatically from your agent.

## Installation

Requires Node.js 22.12 or newer.

```bash
npm install deso-ag
```

Or to use as a CLI globally:

```bash
npm install -g deso-ag
```

### From Source

```bash
git clone https://github.com/mtple/deso-ag
cd deso-ag
pnpm install
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEYNAR_API_KEY` | For Farcaster | None — Farcaster is skipped | Neynar API key. Get one free at [neynar.com](https://neynar.com) |
| `BLUESKY_IDENTIFIER` | For Bluesky search, if the public search endpoint refuses | None — search tries Bluesky's public endpoint first; trending always works | Your Bluesky handle (e.g. `user.bsky.social`) |
| `BLUESKY_APP_PASSWORD` | For Bluesky search, if the public search endpoint refuses | None — as above | App password from [bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords) |
| `HYPERSNAP_NODE_URL` | No | `https://haatz.quilibrium.com` | Hypersnap node to read from. Set it to your own node (e.g. `http://localhost:3381`) to skip the public one |

Hypersnap, Lens, Nostr, and Bluesky trending work without any keys. Bluesky search uses your app password when it's set, and otherwise tries Bluesky's public endpoint, which may require a login.

Add keys to your shell profile so they persist across sessions:

```bash
# Add to ~/.zshrc or ~/.bashrc
export NEYNAR_API_KEY=your-key-here
export BLUESKY_IDENTIFIER=your-handle.bsky.social
export BLUESKY_APP_PASSWORD=your-app-password
```

Without a key, the respective source/feature is skipped and everything else still works normally.

## Commands

### `search [query]`

Search for posts across networks.

```bash
deso-ag search "ethereum"
deso-ag search "AI" --sources nostr
deso-ag search --channel dev --sources farcaster
deso-ag search "quilibrium" --sources hypersnap
```

Multi-word queries use AND semantics (all terms must match):

```bash
deso-ag search "AI crypto"       # posts must contain both "AI" and "crypto"
deso-ag search "ethereum layer2"
```

### `trending`

Get trending posts from all networks.

```bash
deso-ag trending
deso-ag trending --sources farcaster,lens
deso-ag trending --sources hypersnap
deso-ag trending --format json --limit 50
```

### `terms`

Extract top discussion terms from posts via engagement-weighted frequency analysis.

```bash
deso-ag terms                              # top 3 terms per platform, last 24h
deso-ag terms -n 5 -s farcaster -t week    # top 5, Farcaster only, last week
deso-ag terms -f json                      # machine-readable output
```

### `channels`

Browse popular channels, most-followed first. Reads Farcaster's channel list, and falls back to a Hypersnap node (no key) if that can't be reached.

```bash
deso-ag channels
deso-ag channels --limit 50
deso-ag channels --format json
```

## Options

All commands accept the following options (except where noted). An unknown value — a misspelled source, a timeframe like `month`, a limit of `0` — stops the command with an error that lists the valid values, rather than silently falling back.

| Option | Description | Values | Default |
|--------|-------------|--------|---------|
| `-s, --sources` | Networks to query | `farcaster`, `hypersnap`, `lens`, `nostr`, `bluesky` (comma-separated) | `farcaster,hypersnap,lens,nostr,bluesky` (all) |
| `-t, --timeframe` | Time range for posts | `24h`, `48h`, `week` | `24h` |
| `-c, --channel` | Filter by channel | Any channel ID (Farcaster and Hypersnap) | none |
| `-f, --format` | Output format | `json`, `markdown`, `summary`, `compact` (`terms`: `json`, `summary`, `compact`; `channels`: `json`, `summary`) | `markdown` (search), `summary` (trending, terms, channels) |
| `-l, --limit` | Max posts per source | Any positive integer | `25` |
| `-o, --sort` | Sort order | `engagement`, `recent`, `relevance` | `relevance` (search), `engagement` (trending) |
| `-n, --top` | Top terms per source | Any positive integer (terms command only) | `3` |

### Output Formats

- **`markdown`** - Human-readable with headers, author info, and engagement stats. Default for `search`.
- **`summary`** - Condensed overview with post counts and posts in `--sort` order. Default for `trending`.
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
deso-ag trending -f compact -l 10
deso-ag search "AI agents" -f compact -l 10
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
  sources: ['farcaster', 'hypersnap', 'lens', 'nostr', 'bluesky'],
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
import { fetchFarcaster, fetchHypersnap, fetchLens, fetchNostr, fetchBluesky, computeEngagementScore, matchesQuery, extractTerms } from 'deso-ag';
```

## Examples

```bash
# Get a quick summary of trending content
deso-ag trending -f summary -l 20

# Agent-optimized compact output sorted by engagement
deso-ag trending -f compact -o engagement -l 10

# Search for AI discussions on Lens only
deso-ag search "AI" -s lens -f json

# Multi-word search with compact output
deso-ag search "AI crypto" -f compact -l 10

# Browse the /dev channel on Farcaster
deso-ag search --channel dev -s farcaster

# Export trending Nostr posts as JSON
deso-ag trending -s nostr -f json > nostr-trending.json

# Trending on Hypersnap, read from your own node
HYPERSNAP_NODE_URL=http://localhost:3381 deso-ag trending -s hypersnap -f summary

# Search Bluesky for discussions
deso-ag search "ethereum" -s bluesky -l 5

# Trending on Bluesky
deso-ag trending -s bluesky -f summary

# Sort search results by recency
deso-ag search "ethereum" -o recent -f json -l 5

# Top 5 terms across all networks this week
deso-ag terms -n 5 -t week

# Terms from Farcaster and Nostr as JSON
deso-ag terms -f json -s farcaster,nostr -l 10
```

## Supported Networks

| Network | API | Auth |
|---------|-----|------|
| **Farcaster** | [Neynar API](https://neynar.com) - trending feed and full-text search | `NEYNAR_API_KEY` required |
| **Hypersnap** | [Hypersnap](https://hypersnap.org) node v2 API (Neynar-compatible) - trending feed, cast search, channel feeds. Links open in [Quilcast](https://quilcast.com) | None |
| **Lens** | [Lens V3 GraphQL API](https://api.lens.xyz) - server-side search, recent posts (text, image, video and other posts with captions) | None |
| **Nostr** | [nostr.wine](https://docs.nostr.wine) trending and full-text search APIs + public relays (relay.damus.io, relay.primal.net, nos.lol, relay.snort.social) | None |
| **Bluesky** | [AT Protocol API](https://docs.bsky.app) - public "What's Hot" feed for trending, `app.bsky.feed.searchPosts` for search | None (trending); search tries the public endpoint, then `BLUESKY_IDENTIFIER` + `BLUESKY_APP_PASSWORD` |

All networks return engagement stats (likes, reposts, replies) and support timeframe filtering.

## Limitations

- **Farcaster**: Requires `NEYNAR_API_KEY`. Without it, Farcaster is skipped.
- **Hypersnap**: A fork of Farcaster, so casts from before the fork can show up under both networks; cross-source dedup keeps the copy with more engagement. Search hits are filled in with likes/recasts/replies through an extra `cast/bulk` request, and keep zero engagement if that request fails. With `--channel`, a query is matched against the channel's recent casts rather than searched on the node. There's no 48h trending window, so `48h` reads the 7-day ranking and cuts it to 48h.
- **Nostr**: Relay responses can be slow or inconsistent. Search combines nostr.wine's full-text search (free tier: about 1 request per second) with a scan of the latest relay notes; hashtag queries (`#bitcoin`) use the relays' exact tag match. nostr.wine counts trending engagement over at most 48 hours, so `week` trending covers 48h. Search results carry no engagement counts.
- **Bluesky**: Trending reads the "What's Hot" feed, which has no time window of its own; posts outside `--timeframe` are dropped locally. A login is reused for an hour rather than repeated on every search.
- **Farcaster**: There's no 48h trending window, so `48h` reads the 7-day ranking and cuts it to 48h (as with Hypersnap).
- **Rate limits**: All APIs have rate limits. For heavy usage, consider running your own infrastructure.

## Development

```bash
pnpm build       # Build for production
pnpm typecheck   # Type-check without emitting
pnpm test        # Unit tests (no network needed; what CI runs)
pnpm test:live   # CLI tests against the real networks (needs network, and .env keys for Farcaster)
```

## Tech Stack

- TypeScript
- Commander.js for CLI
- nostr-tools for NIP-19 (npub/note) encoding
- Node's built-in fetch and WebSocket

## License

MIT

## Author

[Matt Lee](https://x.com/mattleefc)
