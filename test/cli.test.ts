import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const PKG_VERSION = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf-8')).version;
const HAS_ENV_FILE = existsSync(resolve(PROJECT_ROOT, '.env'));

const CLI = ['npx', ['tsx', 'src/index.ts']] as const;

function run(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec(CLI[0], [...CLI[1], ...args], {
    cwd: PROJECT_ROOT,
    timeout: 60_000,
  });
}

/** Run CLI with a custom environment (strips keys for negative tests) */
function runWithEnv(env: Record<string, string | undefined>, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const filteredEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v !== undefined) filteredEnv[k] = v;
  }
  return exec(CLI[0], [...CLI[1], ...args], {
    cwd: PROJECT_ROOT,
    timeout: 60_000,
    env: filteredEnv,
  });
}

// Use lens for most CLI integration tests (no API key required)
const TEST_SOURCE = 'lens';

describe('CLI integration', () => {
  describe('search command', () => {
    it('runs search with json format', async () => {
      const { stdout } = await run('search', 'test', '-f', 'json', '-l', '3', '-s', TEST_SOURCE);
      // stdout should be valid JSON (array or empty)
      expect(() => JSON.parse(stdout)).not.toThrow();
    }, 60_000);

    it('runs search with compact format', async () => {
      const { stdout } = await run('search', 'test', '-f', 'compact', '-l', '3', '-s', TEST_SOURCE);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('meta');
      expect(parsed).toHaveProperty('posts');
      expect(parsed.meta).toHaveProperty('sources');
      expect(parsed.meta).toHaveProperty('timeframe');
      expect(parsed.meta).toHaveProperty('fetchedAt');
      expect(parsed.meta).toHaveProperty('totalPosts');
    }, 60_000);

    it('runs search with markdown format', async () => {
      const { stdout } = await run('search', 'test', '-f', 'markdown', '-l', '3', '-s', TEST_SOURCE);
      // Should either have results or "No posts found"
      expect(stdout.includes('Social Aggregator Results') || stdout.includes('No posts found')).toBe(true);
    }, 30_000);

    it('accepts --sort option', async () => {
      const { stdout } = await run('search', 'test', '-f', 'json', '-l', '3', '-s', TEST_SOURCE, '-o', 'engagement');
      expect(() => JSON.parse(stdout)).not.toThrow();
    }, 60_000);

    it('prints progress to stderr', async () => {
      const { stderr } = await run('search', 'test', '-f', 'json', '-l', '3', '-s', TEST_SOURCE);
      expect(stderr).toContain('Searching');
    }, 60_000);
  });

  describe('trending command', () => {
    it('runs trending with summary format', async () => {
      const { stdout } = await run('trending', '-f', 'summary', '-l', '3', '-s', TEST_SOURCE);
      // Should contain summary header or no posts
      expect(stdout.length).toBeGreaterThan(0);
    }, 30_000);

    it('runs trending with compact format', async () => {
      const { stdout } = await run('trending', '-f', 'compact', '-l', '3', '-s', TEST_SOURCE);
      const parsed = JSON.parse(stdout);
      expect(parsed.meta).toBeDefined();
      expect(parsed.posts).toBeInstanceOf(Array);
      // Each post should have a score
      if (parsed.posts.length > 0) {
        expect(parsed.posts[0]).toHaveProperty('score');
        expect(parsed.posts[0]).toHaveProperty('engagement');
      }
    }, 30_000);

    it('runs trending with json format and engagement sort', async () => {
      const { stdout } = await run('trending', '-f', 'json', '-l', '5', '-s', TEST_SOURCE, '-o', 'engagement');
      const parsed = JSON.parse(stdout);
      expect(parsed).toBeInstanceOf(Array);
    }, 30_000);

    it('prints progress to stderr', async () => {
      const { stderr } = await run('trending', '-f', 'json', '-l', '3', '-s', TEST_SOURCE);
      expect(stderr).toContain('Fetching trending');
    }, 30_000);
  });

  describe('terms command', () => {
    it('runs terms with summary format', async () => {
      const { stdout } = await run('terms', '-s', TEST_SOURCE, '-l', '5');
      expect(stdout.length).toBeGreaterThan(0);
      expect(stdout).toContain('Top Terms');
    }, 30_000);

    it('runs terms with json format', async () => {
      const { stdout } = await run('terms', '-f', 'json', '-s', TEST_SOURCE, '-l', '5');
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('bySource');
      expect(parsed).toHaveProperty('overall');
      expect(parsed).toHaveProperty('timeframe');
      expect(parsed).toHaveProperty('analyzedAt');
      expect(parsed.bySource).toBeInstanceOf(Array);
    }, 30_000);

    it('runs terms with compact format', async () => {
      const { stdout } = await run('terms', '-f', 'compact', '-s', TEST_SOURCE, '-l', '5');
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('bySource');
      expect(parsed).toHaveProperty('overall');
    }, 30_000);

    it('accepts -n flag for top count', async () => {
      const { stdout } = await run('terms', '-f', 'json', '-n', '5', '-s', TEST_SOURCE, '-l', '5');
      const parsed = JSON.parse(stdout);
      // Each source's terms should have at most 5 entries
      for (const st of parsed.bySource) {
        expect(st.terms.length).toBeLessThanOrEqual(5);
      }
    }, 30_000);

    it('prints progress to stderr', async () => {
      const { stderr } = await run('terms', '-s', TEST_SOURCE, '-l', '3');
      expect(stderr).toContain('Analyzing terms');
    }, 30_000);
  });

  describe('env loading', () => {
    it('shows error when NEYNAR_API_KEY is empty', async () => {
      // Set to empty string so dotenv won't override from .env (dotenv skips existing vars)
      const { stderr } = await runWithEnv(
        { NEYNAR_API_KEY: '' },
        'trending', '-f', 'json', '-l', '3', '-s', 'farcaster',
      );
      expect(stderr).toContain('NEYNAR_API_KEY');
    }, 30_000);

    it.runIf(HAS_ENV_FILE)('loads .env file and picks up NEYNAR_API_KEY', async () => {
      const { stderr } = await run('trending', '-f', 'json', '-l', '1', '-s', 'farcaster');
      // If dotenv loaded correctly, we should NOT see the missing key error
      expect(stderr).not.toContain('requires NEYNAR_API_KEY');
    }, 30_000);

    it.runIf(HAS_ENV_FILE)('loads .env file and picks up BLUESKY credentials', async () => {
      const { stderr } = await run('search', 'test', '-f', 'json', '-l', '1', '-s', 'bluesky');
      expect(stderr).not.toContain('requires BLUESKY_IDENTIFIER');
    }, 60_000);
  });

  describe('per-source connectivity', () => {
    it('farcaster completes and returns valid json', async () => {
      const { stdout, stderr } = await run('trending', '-f', 'json', '-l', '3', '-s', 'farcaster');
      const parsed = JSON.parse(stdout);
      expect(parsed).toBeInstanceOf(Array);
      if (!HAS_ENV_FILE) {
        // Without .env, should warn about missing key (not crash)
        expect(stderr).toContain('NEYNAR_API_KEY');
      } else {
        expect(stderr).not.toContain('requires NEYNAR_API_KEY');
      }
    }, 30_000);

    it('lens completes and returns valid json', async () => {
      const { stdout, stderr } = await run('trending', '-f', 'json', '-l', '3', '-s', 'lens');
      expect(stderr).not.toContain('⚠️  lens:');
      const parsed = JSON.parse(stdout);
      expect(parsed).toBeInstanceOf(Array);
    }, 30_000);

    it('nostr completes and returns valid json', async () => {
      const { stdout, stderr } = await run('trending', '-f', 'json', '-l', '3', '-s', 'nostr');
      expect(stderr).not.toContain('⚠️  nostr:');
      const parsed = JSON.parse(stdout);
      expect(parsed).toBeInstanceOf(Array);
    }, 60_000);

    it('bluesky completes and returns valid json', async () => {
      const { stdout, stderr } = await run('trending', '-f', 'json', '-l', '3', '-s', 'bluesky');
      const parsed = JSON.parse(stdout);
      expect(parsed).toBeInstanceOf(Array);
      if (!HAS_ENV_FILE) {
        // Without .env, should warn about missing credentials (not crash)
        expect(stderr).toContain('BLUESKY_IDENTIFIER');
      } else {
        expect(stderr).not.toContain('requires BLUESKY_IDENTIFIER');
      }
    }, 30_000);

    it('all sources together completes and returns valid output', async () => {
      const { stdout, stderr } = await run('trending', '-f', 'compact', '-l', '3', '-s', 'farcaster,lens,nostr,bluesky');
      const parsed = JSON.parse(stdout);
      expect(parsed.meta.sources).toHaveLength(4);
      if (HAS_ENV_FILE) {
        expect(stderr).not.toContain('requires NEYNAR_API_KEY');
        expect(stderr).not.toContain('requires BLUESKY_IDENTIFIER');
      }
    }, 90_000);
  });

  describe('option validation', () => {
    it('shows version with --version', async () => {
      const { stdout } = await run('--version');
      expect(stdout.trim()).toBe(PKG_VERSION);
    });

    it('shows help with --help', async () => {
      const { stdout } = await run('--help');
      expect(stdout).toContain('deso-ag');
      expect(stdout).toContain('search');
      expect(stdout).toContain('trending');
      expect(stdout).toContain('terms');
      expect(stdout).toContain('channels');
    });

    it('search --help shows all options', async () => {
      const { stdout } = await run('search', '--help');
      expect(stdout).toContain('--sources');
      expect(stdout).toContain('--format');
      expect(stdout).toContain('--sort');
      expect(stdout).toContain('--limit');
      expect(stdout).toContain('--timeframe');
    });

    it('trending --help shows all options', async () => {
      const { stdout } = await run('trending', '--help');
      expect(stdout).toContain('--sort');
      expect(stdout).toContain('--format');
      expect(stdout).toContain('compact');
    });
  });
});
