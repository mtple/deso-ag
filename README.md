# deso-ag

**Decentralized Social Aggregator** - A CLI tool for aggregating posts from decentralized social protocols.

Search and view content across **Farcaster**, **Lens**, and **Nostr** from your terminal. No API keys required.

## Features

- 🔍 **Search** across all three protocols simultaneously
- 📈 **Trending** posts from popular channels and relays
- 📺 **Browse** Farcaster channels
- 📝 **Multiple output formats**: JSON, Markdown, Summary
- ⚡ **Zero configuration** - works out of the box
- 🔑 **No API keys required** - uses free public endpoints

## Installation

```bash
# Install globally
npm install -g deso-ag

# Or run directly with npx
npx deso-ag trending
```

## Usage

### Trending Posts

Get trending posts from all networks:

```bash
deso-ag trending
deso-ag trending --sources farcaster,lens
deso-ag trending --format json --limit 50
```

### Search

Search for posts across networks:

```bash
deso-ag search "ethereum"
deso-ag search "AI" --sources nostr
deso-ag search --channel dev --sources farcaster
```

### List Channels

Browse popular Farcaster channels:

```bash
deso-ag channels
deso-ag channels --limit 50
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --sources` | Networks to query (farcaster,lens,nostr) | all |
| `-t, --timeframe` | Time range (24h, 48h, week) | 24h |
| `-c, --channel` | Filter by channel (Farcaster only) | — |
| `-f, --format` | Output format (json, markdown, summary) | markdown |
| `-l, --limit` | Max posts per source | 25 |

## Examples

```bash
# Get a quick summary of trending content
deso-ag trending -f summary -l 20

# Search for AI discussions on Lens
deso-ag search "AI" -s lens -f json

# Browse the /dev channel on Farcaster
deso-ag search --channel dev -s farcaster

# Export trending Nostr posts as JSON
deso-ag trending -s nostr -f json > nostr-trending.json

# See what hashtags are trending
deso-ag trending -f summary | grep "Trending Tags"
```

## Supported Networks

### Farcaster
- Uses free [Pinata Hub API](https://hub.pinata.cloud) and [Farcaster Client API](https://api.farcaster.xyz)
- Queries popular channels: farcaster, ethereum, base, dev, founders, degen, crypto
- Channel-specific queries supported via `--channel`

### Lens
- Uses [Lens V3 GraphQL API](https://api.lens.xyz)
- Fetches recent posts with engagement stats
- No API key needed

### Nostr
- Connects to public relays: relay.damus.io, relay.nostr.band, nos.lol, relay.snort.social
- Fetches profiles for author resolution
- Hashtag extraction from event tags

## Limitations

- **Farcaster**: Without a Neynar API key, results may include older posts. The free hub API doesn't support timestamp-based queries. For real-time feeds, consider using [Neynar](https://neynar.com).
- **Nostr**: Relay responses can be slow or inconsistent depending on network conditions.
- **Rate limits**: All APIs have rate limits. For heavy usage, consider running your own infrastructure.

## Development

```bash
# Clone the repo
git clone https://github.com/sphairetra/deso-ag
cd deso-ag

# Install dependencies
npm install

# Build
npm run build

# Run in development
npm run dev -- trending

# Test
npm test
```

## Tech Stack

- TypeScript
- Commander.js for CLI
- nostr-tools for Nostr protocol
- Native fetch for HTTP requests

## License

MIT

## Author

[@mattlee.eth](https://warpcast.com/mattlee.eth)

---

*Built with ❤️ for the decentralized social ecosystem*
