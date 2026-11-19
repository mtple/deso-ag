import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// CLI tests that need no network: option handling, plus a full run against a fake Hypersnap node.

const exec = promisify(execFile);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_VERSION = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf-8')).version;

function run(args: string[], env: Record<string, string> = {}) {
  return exec('npx', ['tsx', 'src/index.ts', ...args], {
    cwd: PROJECT_ROOT,
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
}

async function runFailing(args: string[]): Promise<{ code: number; stderr: string }> {
  try {
    await run(args);
  } catch (error) {
    const e = error as { code: number; stderr: string };
    return { code: e.code, stderr: e.stderr };
  }
  throw new Error(`expected "deso-ag ${args.join(' ')}" to fail`);
}

describe('CLI options', () => {
  it('shows version with --version', async () => {
    const { stdout } = await run(['--version']);
    expect(stdout.trim()).toBe(PKG_VERSION);
  }, 30_000);

  it('shows help with --help', async () => {
    const { stdout } = await run(['--help']);
    for (const word of ['deso-ag', 'search', 'trending', 'terms', 'channels']) {
      expect(stdout).toContain(word);
    }
  }, 30_000);

  it('search --help lists every option', async () => {
    const { stdout } = await run(['search', '--help']);
    for (const flag of ['--sources', '--format', '--sort', '--limit', '--timeframe', '--channel']) {
      expect(stdout).toContain(flag);
    }
    expect(stdout).toContain('hypersnap');
  }, 30_000);

  it('rejects an unknown source instead of searching nothing', async () => {
    const { code, stderr } = await runFailing(['trending', '-s', 'farcastr']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown source "farcastr"');
  }, 30_000);

  it('rejects a bad timeframe, format, sort and limit', async () => {
    expect((await runFailing(['trending', '-t', 'month'])).stderr).toContain('Unknown timeframe "month"');
    expect((await runFailing(['trending', '-f', 'xml'])).stderr).toContain('Unknown format "xml"');
    expect((await runFailing(['trending', '-o', 'random'])).stderr).toContain('Unknown sort order "random"');
    expect((await runFailing(['search', 'x', '-l', 'ten'])).stderr).toContain('limit must be a whole number');
  }, 60_000);
});

describe('CLI against a fake Hypersnap node', () => {
  let server: Server;
  let nodeUrl: string;

  beforeAll(async () => {
    const now = Date.now();
    const cast = (hash: string, text: string, minsAgo: number, likes: number) => ({
      hash,
      author: { fid: 1, username: 'alice', display_name: 'Alice' },
      text,
      timestamp: new Date(now - minsAgo * 60_000).toISOString(),
      reactions: { likes_count: likes, recasts_count: 0 },
      replies: { count: 0 },
    });

    server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/v2/farcaster/feed/trending') {
        res.end(JSON.stringify({
          casts: [
            cast('0x01', 'older but popular cast', 300, 90),
            cast('0x02', 'brand new quiet cast', 5, 1),
          ],
        }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ message: 'not found' }));
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    nodeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('prints compact JSON whose meta matches the posts', async () => {
    const { stdout } = await run(['trending', '-s', 'hypersnap', '-f', 'compact'], { HYPERSNAP_NODE_URL: nodeUrl });
    const parsed = JSON.parse(stdout);
    expect(parsed.meta.totalPosts).toBe(parsed.posts.length);
    expect(parsed.posts.map((p: { id: string }) => p.id)).toEqual(['0x01', '0x02']);
  }, 30_000);

  it('summary output follows --sort recent', async () => {
    const { stdout } = await run(['trending', '-s', 'hypersnap', '-f', 'summary', '-o', 'recent'], { HYPERSNAP_NODE_URL: nodeUrl });
    expect(stdout.indexOf('brand new quiet cast')).toBeLessThan(stdout.indexOf('older but popular cast'));
  }, 30_000);
});
