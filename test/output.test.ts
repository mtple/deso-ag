import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeEngagementScore, formatOutput, formatTermsSummary } from '../src/formatters/output.js';
import { makePost } from './helpers.js';
import type { AggregateResult, TermsResult } from '../src/types.js';

describe('computeEngagementScore', () => {
  it('computes likes + reposts*2 + replies', () => {
    const post = makePost({
      engagement: { likes: 100, reposts: 50, replies: 25 },
    });
    // 100 + 50*2 + 25 = 225
    expect(computeEngagementScore(post)).toBe(225);
  });

  it('handles missing engagement', () => {
    const post = makePost();
    // Remove engagement entirely
    delete (post as any).engagement;
    expect(computeEngagementScore(post)).toBe(0);
  });

  it('handles partial engagement', () => {
    const post = makePost({ engagement: { likes: 10 } });
    // 10 + 0 + 0 = 10
    expect(computeEngagementScore(post)).toBe(10);
  });

  it('weights reposts double', () => {
    const a = makePost({ engagement: { likes: 0, reposts: 10, replies: 0 } });
    const b = makePost({ engagement: { likes: 20, reposts: 0, replies: 0 } });
    expect(computeEngagementScore(a)).toBe(20);
    expect(computeEngagementScore(b)).toBe(20);
  });
});

describe('formatOutput', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('empty posts', () => {
    it('json returns empty array', () => {
      const result = formatOutput([], 'json');
      expect(JSON.parse(result)).toEqual([]);
    });

    it('markdown returns no-posts message', () => {
      const result = formatOutput([], 'markdown');
      expect(result).toContain('No posts found');
    });

    it('summary returns no-posts message', () => {
      const result = formatOutput([], 'summary');
      expect(result).toContain('No posts found');
    });

    it('compact returns empty posts array with meta', () => {
      const result = formatOutput([], 'compact');
      const parsed = JSON.parse(result);
      expect(parsed.posts).toEqual([]);
      expect(parsed.meta).toBeDefined();
    });
  });

  describe('filters empty content', () => {
    it('excludes posts with whitespace-only content', () => {
      const posts = [
        makePost({ id: '1', content: '   ' }),
        makePost({ id: '2', content: 'real content' }),
      ];
      const result = formatOutput(posts, 'json');
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('2');
    });
  });

  describe('json format', () => {
    it('serializes dates as ISO strings', () => {
      const posts = [makePost({ timestamp: new Date('2025-01-15T12:00:00Z') })];
      const result = formatOutput(posts, 'json');
      const parsed = JSON.parse(result);
      expect(parsed[0].timestamp).toBe('2025-01-15T12:00:00.000Z');
    });

    it('includes all post fields', () => {
      const posts = [makePost({ tags: ['eth', 'defi'] })];
      const result = formatOutput(posts, 'json');
      const parsed = JSON.parse(result);
      expect(parsed[0].tags).toEqual(['eth', 'defi']);
      expect(parsed[0].source).toBe('farcaster');
      expect(parsed[0].engagement).toBeDefined();
    });
  });

  describe('markdown format', () => {
    it('includes header with post count', () => {
      const posts = [makePost(), makePost({ id: '2' })];
      const result = formatOutput(posts, 'markdown');
      expect(result).toContain('Found 2 posts');
    });

    it('includes author username', () => {
      const posts = [makePost({ author: { username: 'alice' } })];
      const result = formatOutput(posts, 'markdown');
      expect(result).toContain('@alice');
    });

    it('truncates long content at 2500 chars', () => {
      const longContent = 'a'.repeat(3000);
      const posts = [makePost({ content: longContent })];
      const result = formatOutput(posts, 'markdown');
      expect(result).toContain('...');
      // Should not contain the full 3000 chars
      expect(result.length).toBeLessThan(3500);
    });

    it('includes engagement stats', () => {
      const posts = [makePost({ engagement: { likes: 42, reposts: 7, replies: 3 } })];
      const result = formatOutput(posts, 'markdown');
      expect(result).toContain('42');
      expect(result).toContain('7');
    });

    it('includes tags', () => {
      const posts = [makePost({ tags: ['defi', 'eth'] })];
      const result = formatOutput(posts, 'markdown');
      expect(result).toContain('#defi');
      expect(result).toContain('#eth');
    });

    it('includes url link', () => {
      const posts = [makePost({ url: 'https://example.com/post' })];
      const result = formatOutput(posts, 'markdown');
      expect(result).toContain('https://example.com/post');
    });
  });

  describe('summary format', () => {
    it('groups posts by source', () => {
      const posts = [
        makePost({ id: '1', source: 'farcaster' }),
        makePost({ id: '2', source: 'lens' }),
        makePost({ id: '3', source: 'farcaster' }),
      ];
      const result = formatOutput(posts, 'summary');
      expect(result).toContain('Farcaster: 2 posts');
      expect(result).toContain('Lens: 1 posts');
    });

    it('shows total post count', () => {
      const posts = [makePost({ id: '1' }), makePost({ id: '2' })];
      const result = formatOutput(posts, 'summary');
      expect(result).toContain('Total: 2 posts');
    });

    it('shows trending tags only when count > 1', () => {
      const posts = [
        makePost({ id: '1', tags: ['eth', 'defi'] }),
        makePost({ id: '2', tags: ['eth'] }),
      ];
      const result = formatOutput(posts, 'summary');
      expect(result).toContain('#eth (2)');
      expect(result).not.toContain('#defi');
    });

    it('hides trending tags section when no tag appears more than once', () => {
      const posts = [
        makePost({ id: '1', tags: ['eth'] }),
        makePost({ id: '2', tags: ['defi'] }),
      ];
      const result = formatOutput(posts, 'summary');
      expect(result).not.toContain('Trending Tags');
    });
  });

  describe('compact format', () => {
    const meta: AggregateResult['meta'] = {
      query: 'test query',
      sources: [
        { name: 'farcaster', count: 5 },
        { name: 'lens', count: 3 },
      ],
      timeframe: '24h',
      fetchedAt: '2025-01-15T12:00:00.000Z',
      totalPosts: 8,
    };

    it('returns valid JSON', () => {
      const posts = [makePost()];
      const result = formatOutput(posts, 'compact', meta);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('includes meta envelope', () => {
      const posts = [makePost()];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      expect(parsed.meta.query).toBe('test query');
      expect(parsed.meta.totalPosts).toBe(8);
      expect(parsed.meta.timeframe).toBe('24h');
      expect(parsed.meta.sources).toHaveLength(2);
    });

    it('flattens author to username string', () => {
      const posts = [makePost({ author: { username: 'bob', displayName: 'Bob' } })];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      expect(parsed.posts[0].author).toBe('bob');
    });

    it('includes pre-computed engagement score', () => {
      const posts = [makePost({ engagement: { likes: 10, reposts: 5, replies: 3 } })];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      // 10 + 5*2 + 3 = 23
      expect(parsed.posts[0].score).toBe(23);
    });

    it('does not truncate content', () => {
      const longContent = 'a'.repeat(5000);
      const posts = [makePost({ content: longContent })];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      expect(parsed.posts[0].content.length).toBe(5000);
    });

    it('normalizes engagement to zero defaults', () => {
      const post = makePost();
      delete (post as any).engagement;
      const posts = [post];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      expect(parsed.posts[0].engagement).toEqual({ likes: 0, reposts: 0, replies: 0 });
    });

    it('defaults tags to empty array', () => {
      const posts = [makePost({ tags: undefined })];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      expect(parsed.posts[0].tags).toEqual([]);
    });

    it('uses fallback meta when none provided', () => {
      const posts = [makePost()];
      const result = formatOutput(posts, 'compact');
      const parsed = JSON.parse(result);
      expect(parsed.meta.totalPosts).toBe(1);
      expect(parsed.meta.timeframe).toBe('unknown');
      expect(parsed.meta.fetchedAt).toBeDefined();
    });

    it('serializes timestamps as ISO strings', () => {
      const posts = [makePost({ timestamp: new Date('2025-01-15T12:00:00Z') })];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      expect(parsed.posts[0].timestamp).toBe('2025-01-15T12:00:00.000Z');
    });

    it('sets url to null when missing', () => {
      const post = makePost();
      delete (post as any).url;
      const posts = [post];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      expect(parsed.posts[0].url).toBeNull();
    });
  });

  describe('compact format with terms', () => {
    const meta: AggregateResult['meta'] = {
      query: 'test',
      sources: [{ name: 'farcaster', count: 5 }],
      timeframe: '24h',
      fetchedAt: '2025-01-15T12:00:00.000Z',
      totalPosts: 5,
    };

    const termsResult: TermsResult = {
      bySource: [{
        source: 'farcaster',
        postCount: 5,
        terms: [
          { token: 'bitcoin', score: 24.3, postCount: 4 },
          { token: 'ethereum', score: 18.1, postCount: 3 },
        ],
      }],
      overall: [
        { token: 'bitcoin', score: 24.3, postCount: 4 },
        { token: 'ethereum', score: 18.1, postCount: 3 },
      ],
      timeframe: '24h',
      analyzedAt: '2025-01-15T12:00:00.000Z',
    };

    it('includes terms in compact output when provided', () => {
      const posts = [makePost()];
      const result = formatOutput(posts, 'compact', meta, termsResult);
      const parsed = JSON.parse(result);
      expect(parsed.terms).toBeDefined();
      expect(parsed.terms.bySource).toHaveLength(1);
      expect(parsed.terms.overall).toHaveLength(2);
      expect(parsed.terms.overall[0].token).toBe('bitcoin');
    });

    it('omits terms from compact output when not provided', () => {
      const posts = [makePost()];
      const result = formatOutput(posts, 'compact', meta);
      const parsed = JSON.parse(result);
      expect(parsed.terms).toBeUndefined();
    });
  });

  describe('unknown format defaults to markdown', () => {
    it('falls back to markdown', () => {
      const posts = [makePost()];
      // Force an unknown format through type assertion
      const result = formatOutput(posts, 'unknown' as any);
      expect(result).toContain('Social Aggregator Results');
    });
  });
});

describe('formatTermsSummary', () => {
  it('formats terms with source sections', () => {
    const termsResult: TermsResult = {
      bySource: [{
        source: 'farcaster',
        postCount: 47,
        terms: [
          { token: 'base chain', score: 24.3, postCount: 8 },
          { token: 'ethereum', score: 19.1, postCount: 12 },
        ],
      }],
      overall: [
        { token: 'base chain', score: 24.3, postCount: 8 },
        { token: 'ethereum', score: 19.1, postCount: 12 },
      ],
      timeframe: '24h',
      analyzedAt: '2025-01-15T12:00:00.000Z',
    };

    const result = formatTermsSummary(termsResult);
    expect(result).toContain('Top Terms (last 24h)');
    expect(result).toContain('Farcaster (47 posts analyzed)');
    expect(result).toContain('base chain');
    expect(result).toContain('24.3');
    expect(result).toContain('in 8 posts');
    expect(result).toContain('Overall Top Terms');
  });

  it('shows "No significant terms" when source has no terms', () => {
    const termsResult: TermsResult = {
      bySource: [{
        source: 'nostr',
        postCount: 2,
        terms: [],
      }],
      overall: [],
      timeframe: 'week',
      analyzedAt: '2025-01-15T12:00:00.000Z',
    };

    const result = formatTermsSummary(termsResult);
    expect(result).toContain('No significant terms found');
    expect(result).toContain('Nostr (2 posts analyzed)');
    expect(result).toContain('last week');
  });

  it('includes correct source emojis', () => {
    const termsResult: TermsResult = {
      bySource: [
        { source: 'farcaster', postCount: 1, terms: [{ token: 'test', score: 1, postCount: 1 }] },
        { source: 'lens', postCount: 1, terms: [{ token: 'test', score: 1, postCount: 1 }] },
        { source: 'nostr', postCount: 1, terms: [{ token: 'test', score: 1, postCount: 1 }] },
        { source: 'bluesky', postCount: 1, terms: [{ token: 'test', score: 1, postCount: 1 }] },
      ],
      overall: [],
      timeframe: '24h',
      analyzedAt: '2025-01-15T12:00:00.000Z',
    };

    const result = formatTermsSummary(termsResult);
    expect(result).toContain('🟣 Farcaster');
    expect(result).toContain('🌿 Lens');
    expect(result).toContain('⚡ Nostr');
    expect(result).toContain('🦋 Bluesky');
  });
});
