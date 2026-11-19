import { defineConfig } from 'vitest/config';

// Live tests: run the CLI against the real Farcaster, Hypersnap, Lens, Nostr and Bluesky APIs.
// They need network access, and keys from .env for Farcaster and Bluesky search.
export default defineConfig({
  test: {
    include: ['test/cli.test.ts'],
    testTimeout: 90_000,
  },
});
