# deso-ag Command Reference

## Table of Contents

1. [search](#search)
2. [trending](#trending)
3. [terms](#terms)
4. [channels](#channels)
5. [Global Options](#global-options)
6. [Output Formats](#output-formats)
7. [Sort Orders](#sort-orders)
8. [Network Details](#network-details)
9. [Library Usage](#library-usage)

---

## search

Search for posts across decentralized social networks.

```
deso-ag search [query] [options]
```

**Arguments:**
- `query` — Search string. Multi-word queries use AND semantics (all terms must match).

**Examples:**
```bash
deso-ag search "ethereum" --format compact --limit 20
deso-ag search "AI crypto" --format compact              # AND: both terms required
deso-ag search "NFT" --sources farcaster --format compact
deso-ag search --channel dev --sources farcaster --format compact
deso-ag search "base chain" --sort recent --format compact --limit 10
```

**Defaults:** sort=relevance, format=markdown, limit=25, timeframe=24h, sources=all

---

## trending

Get trending/popular posts from all networks.

```
deso-ag trending [options]
```

**Examples:**
```bash
deso-ag trending --format compact --limit 20
deso-ag trending --sources farcaster,lens --format compact
deso-ag trending --timeframe week --format compact --sort engagement
```

**Defaults:** sort=engagement, format=summary, limit=25, timeframe=24h, sources=all

---

## terms

Extract top discussion terms via engagement-weighted frequency analysis.

```
deso-ag terms [options]
```

**Options (terms-specific):**
- `-n, --top <number>` — Top N terms per source (default: 3)

**Examples:**
```bash
deso-ag terms                                          # top 3, all networks, 24h
deso-ag terms --top 5 --sources farcaster --timeframe week --format json
deso-ag terms --format json --sources farcaster,nostr --limit 10
```

---

## channels

Browse popular channels, most-followed first. Reads Farcaster's channel list and falls back to a Hypersnap node when that can't be reached.

```
deso-ag channels [options]
```

**Options:** `-l, --limit <n>` (default 20), `-f, --format json|summary` (default summary)

**Examples:**
```bash
deso-ag channels
deso-ag channels --limit 50 --format json
```

---

## Global Options

All commands accept these (except where noted). Invalid values are rejected with an error listing the valid ones:

| Option | Short | Description | Values | Default |
|--------|-------|-------------|--------|---------|
| `--sources` | `-s` | Networks to query | farcaster, hypersnap, lens, nostr, bluesky (comma-separated) | all five |
| `--timeframe` | `-t` | Time range | 24h, 48h, week | 24h |
| `--channel` | `-c` | Channel filter (Farcaster and Hypersnap) | Any channel ID | none |
| `--format` | `-f` | Output format | json, markdown, summary, compact | varies by command |
| `--limit` | `-l` | Max posts per source | Any positive integer | 25 |
| `--sort` | `-o` | Sort order | engagement, recent, relevance | varies by command |

---

## Output Formats

### compact (use this for AI analysis)

Single JSON object with metadata envelope and full post data:

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

Key features: pre-computed engagement `score` (likes + reposts×2 + replies), full untruncated `content`, source health info in `meta.sources`.

### json

Raw JSON array of post objects. Good for piping to other tools.

### markdown

Human-readable with headers, author info, and engagement stats. Default for `search`.

### summary

Condensed overview with post counts and top content. Default for `trending`.

---

## Sort Orders

| Sort | Formula / Logic | Best For |
|------|----------------|----------|
| engagement | likes + reposts×2 + replies | High-signal content discovery |
| recent | Timestamp descending | Monitoring, latest updates |
| relevance | Query match first, then engagement | Search (default) |

---

## Network Details

| Network | Auth Required | Search | Trending | Notes |
|---------|--------------|--------|----------|-------|
| Farcaster | NEYNAR_API_KEY | ✅ | ✅ | Skipped entirely without key |
| Hypersnap | None (optional HYPERSNAP_NODE_URL) | ✅ | ✅ | Farcaster fork; defaults to the public node haatz.quilibrium.com |
| Lens | None | ✅ | ✅ | GraphQL API, always available |
| Nostr | None | ✅ | ✅ | nostr.wine search + relay scan; trending covers 48h at most |
| Bluesky | None for trending; search tries the public endpoint, then BLUESKY_IDENTIFIER + BLUESKY_APP_PASSWORD | ✅ | ✅ | Search limited to the timeframe with `since` |

---

## Library Usage

For Node.js agents, import directly instead of CLI:

```javascript
import { aggregate } from 'deso-ag';

const result = await aggregate({
  sources: ['farcaster', 'hypersnap', 'lens', 'nostr', 'bluesky'],
  timeframe: '24h',
  query: 'AI agents',
  limit: 20,
  sort: 'relevance',
});

// result.meta.totalPosts, result.posts[].content, etc.
```

Terms extraction:

```javascript
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

Individual exports: `fetchFarcaster`, `fetchHypersnap`, `fetchLens`, `fetchNostr`, `fetchBluesky`, `fetchChannels`, `computeEngagementScore`, `matchesQuery`, `extractTerms`, and the option lists `SOURCES`, `TIMEFRAMES`, `OUTPUT_FORMATS`, `SORT_ORDERS`.
