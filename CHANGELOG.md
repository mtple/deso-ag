# Changelog

## 1.1.0

### Added
- **Hypersnap** as a fifth source (on by default, no key). Reads a Hypersnap node's Neynar-compatible API: the public node `haatz.quilibrium.com`, or `HYPERSNAP_NODE_URL`.
- `channels` falls back to a Hypersnap node when Farcaster's channel list can't be reached, and takes `--format json`.
- Nostr full-text search through nostr.wine, alongside the relay scan.
- Bluesky search tries the public endpoint when no app password is set.
- `fetchChannels`, `SOURCES`, `TIMEFRAMES`, `OUTPUT_FORMATS` and `SORT_ORDERS` exported from the library.

### Fixed
- Nostr profile and post links: real NIP-19 `npub`/`note` encoding instead of a truncated hex string.
- Nostr: replaced the dead relay.nostr.band; `--limit` applied to search results.
- Bluesky search now limits results to the timeframe (`since`) instead of ranking all-time posts and cutting them; `--sort recent` uses Bluesky's `latest` order; logins are reused.
- Lens honors `--limit`, times out after 10 seconds, pages through results, and includes image, video and other posts with captions.
- Farcaster `48h` trending covers 48 hours (it was cut to 24).
- `compact` output's `meta.totalPosts` matches the posts returned (it counted duplicates before they were removed).
- `summary` output follows `--sort` instead of always re-sorting by engagement.
- Unknown sources, timeframes, formats, sort orders and non-positive limits are errors instead of silent fallbacks.
- Trending terms keep accented and non-Latin words whole.

### Changed
- Requires Node.js 22.12 or newer (Node 18 and 20 are end-of-life). Uses Node's built-in WebSocket; `websocket-polyfill` is gone.
- The CLI runs the same `aggregate()` the library exports.
- `pnpm test` runs unit tests only; the network-dependent CLI tests moved to `pnpm test:live`. CI runs on Node 22 and 24.
- Dependencies updated (commander 15, dotenv 18, nostr-tools 2.26, TypeScript 7, vitest 5).
