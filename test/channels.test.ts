import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchChannels } from '../src/channels.js';

function response(data: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(data) };
}

describe('fetchChannels', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.HYPERSNAP_NODE_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('lists Farcaster channels by follower count', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response({
      result: {
        channels: [
          { id: 'small', name: 'Small', followerCount: 10 },
          { id: 'big', name: 'Big', followerCount: 5000, description: 'the big one' },
          { id: 'mid', name: 'Mid', followerCount: 300 },
        ],
      },
    }));

    const result = await fetchChannels(2);

    expect(result.source).toBe('farcaster');
    expect(result.channels.map(c => c.id)).toEqual(['big', 'mid']);
    expect(result.channels[0].description).toBe('the big one');
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('https://api.farcaster.xyz/v2/all-channels');
  });

  it('falls back to the Hypersnap node when Farcaster fails', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response({}, false, 503))
      .mockResolvedValueOnce(response({
        channels: [
          { id: 'dev', name: 'dev', follower_count: 900, description: null },
          { id: 'music', name: 'music', follower_count: 1200 },
        ],
      }));

    const result = await fetchChannels(5);

    expect(result.source).toBe('hypersnap');
    expect(result.fallbackReason).toContain('503');
    expect(result.channels.map(c => [c.id, c.followerCount])).toEqual([['music', 1200], ['dev', 900]]);
    expect(vi.mocked(globalThis.fetch).mock.calls[1][0]).toBe('https://haatz.quilibrium.com/v2/farcaster/channel/trending?limit=50');
  });

  it('says what went wrong on both sides when neither answers', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response({}, false, 500))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(fetchChannels()).rejects.toThrow(/Farcaster: api\.farcaster\.xyz: 500\. Hypersnap: connect ECONNREFUSED/);
  });
});
