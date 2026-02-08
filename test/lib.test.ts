import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePost } from './helpers.js';
import type { FetchResult } from '../src/types.js';

// Mock all fetchers before importing lib
vi.mock('../src/fetchers/farcaster.js', () => ({
  fetchFarcaster: vi.fn(),
}));
vi.mock('../src/fetchers/lens.js', () => ({
  fetchLens: vi.fn(),
}));
vi.mock('../src/fetchers/nostr.js', () => ({
  fetchNostr: vi.fn(),
}));

// Import after mocking
const { aggregate } = await import('../src/lib.js');
const { fetchFarcaster } = await import('../src/fetchers/farcaster.js');
const { fetchLens } = await import('../src/fetchers/lens.js');
const { fetchNostr } = await import('../src/fetchers/nostr.js');

const mockFarcaster = vi.mocked(fetchFarcaster);
const mockLens = vi.mocked(fetchLens);
const mockNostr = vi.mocked(fetchNostr);

describe('aggregate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct AggregateResult shape', async () => {
    mockFarcaster.mockResolvedValue({
      posts: [makePost({ id: '1', source: 'farcaster', content: 'farcaster post here' })],
      source: 'farcaster',
    });

    const result = await aggregate({
      sources: ['farcaster'],
      timeframe: '24h',
      limit: 10,
    });

    expect(result.posts).toBeInstanceOf(Array);
    expect(result.meta).toBeDefined();
    expect(result.meta.sources).toBeInstanceOf(Array);
    expect(result.meta.timeframe).toBe('24h');
    expect(result.meta.fetchedAt).toBeDefined();
    expect(result.meta.totalPosts).toBeTypeOf('number');
  });

  it('fetches from requested sources only', async () => {
    mockFarcaster.mockResolvedValue({ posts: [], source: 'farcaster' });
    mockLens.mockResolvedValue({ posts: [], source: 'lens' });

    await aggregate({
      sources: ['farcaster', 'lens'],
      timeframe: '24h',
    });

    expect(mockFarcaster).toHaveBeenCalledOnce();
    expect(mockLens).toHaveBeenCalledOnce();
    expect(mockNostr).not.toHaveBeenCalled();
  });

  it('merges posts from multiple sources', async () => {
    mockFarcaster.mockResolvedValue({
      posts: [makePost({ id: '1', source: 'farcaster', content: 'unique farcaster content about something' })],
      source: 'farcaster',
    });
    mockLens.mockResolvedValue({
      posts: [makePost({ id: '2', source: 'lens', content: 'unique lens content about something else' })],
      source: 'lens',
    });

    const result = await aggregate({
      sources: ['farcaster', 'lens'],
      timeframe: '24h',
    });

    expect(result.posts).toHaveLength(2);
  });

  it('deduplicates across sources', async () => {
    const content = 'this exact same post appears on both farcaster and lens for some reason';
    mockFarcaster.mockResolvedValue({
      posts: [makePost({ id: '1', source: 'farcaster', content })],
      source: 'farcaster',
    });
    mockLens.mockResolvedValue({
      posts: [makePost({ id: '2', source: 'lens', content })],
      source: 'lens',
    });

    const result = await aggregate({
      sources: ['farcaster', 'lens'],
      timeframe: '24h',
    });

    expect(result.posts).toHaveLength(1);
  });

  it('builds meta with source counts', async () => {
    mockFarcaster.mockResolvedValue({
      posts: [
        makePost({ id: '1', source: 'farcaster', content: 'post one from farcaster' }),
        makePost({ id: '2', source: 'farcaster', content: 'post two from farcaster' }),
      ],
      source: 'farcaster',
    });
    mockLens.mockResolvedValue({
      posts: [makePost({ id: '3', source: 'lens', content: 'post from lens' })],
      source: 'lens',
    });

    const result = await aggregate({
      sources: ['farcaster', 'lens'],
      timeframe: '24h',
    });

    expect(result.meta.sources).toEqual([
      { name: 'farcaster', count: 2, error: undefined },
      { name: 'lens', count: 1, error: undefined },
    ]);
  });

  it('includes errors in meta', async () => {
    mockFarcaster.mockResolvedValue({
      posts: [],
      source: 'farcaster',
      error: 'API timeout',
    });

    const result = await aggregate({
      sources: ['farcaster'],
      timeframe: '24h',
    });

    expect(result.meta.sources[0].error).toBe('API timeout');
  });

  it('includes query in meta', async () => {
    mockFarcaster.mockResolvedValue({ posts: [], source: 'farcaster' });

    const result = await aggregate({
      sources: ['farcaster'],
      timeframe: '24h',
      query: 'ethereum',
    });

    expect(result.meta.query).toBe('ethereum');
  });

  it('defaults to relevance sort when query is provided', async () => {
    const matching = makePost({
      id: 'match',
      source: 'farcaster',
      content: 'ethereum is amazing technology',
      engagement: { likes: 1, reposts: 0, replies: 0 },
    });
    const nonMatching = makePost({
      id: 'nomatch',
      source: 'farcaster',
      content: 'hello world today is great',
      engagement: { likes: 1000, reposts: 500, replies: 100 },
    });

    mockFarcaster.mockResolvedValue({
      posts: [nonMatching, matching],
      source: 'farcaster',
    });

    const result = await aggregate({
      sources: ['farcaster'],
      timeframe: '24h',
      query: 'ethereum',
    });

    expect(result.posts[0].id).toBe('match');
  });

  it('defaults to engagement sort when no query', async () => {
    const low = makePost({
      id: 'low',
      source: 'farcaster',
      content: 'low engagement post content here',
      engagement: { likes: 1, reposts: 0, replies: 0 },
    });
    const high = makePost({
      id: 'high',
      source: 'farcaster',
      content: 'high engagement post content here',
      engagement: { likes: 100, reposts: 50, replies: 10 },
    });

    mockFarcaster.mockResolvedValue({
      posts: [low, high],
      source: 'farcaster',
    });

    const result = await aggregate({
      sources: ['farcaster'],
      timeframe: '24h',
    });

    expect(result.posts[0].id).toBe('high');
  });

  it('respects explicit sort override', async () => {
    const older = makePost({
      id: 'old',
      source: 'farcaster',
      content: 'older high-engagement post here',
      timestamp: new Date('2025-01-14T12:00:00Z'),
      engagement: { likes: 1000, reposts: 500, replies: 100 },
    });
    const newer = makePost({
      id: 'new',
      source: 'farcaster',
      content: 'newer low-engagement post here',
      timestamp: new Date('2025-01-15T12:00:00Z'),
      engagement: { likes: 1, reposts: 0, replies: 0 },
    });

    mockFarcaster.mockResolvedValue({
      posts: [older, newer],
      source: 'farcaster',
    });

    const result = await aggregate({
      sources: ['farcaster'],
      timeframe: '24h',
      sort: 'recent',
    });

    expect(result.posts[0].id).toBe('new');
  });

  it('handles all sources returning empty', async () => {
    mockFarcaster.mockResolvedValue({ posts: [], source: 'farcaster' });
    mockLens.mockResolvedValue({ posts: [], source: 'lens' });
    mockNostr.mockResolvedValue({ posts: [], source: 'nostr' });

    const result = await aggregate({
      sources: ['farcaster', 'lens', 'nostr'],
      timeframe: '24h',
    });

    expect(result.posts).toEqual([]);
    expect(result.meta.totalPosts).toBe(0);
  });
});
