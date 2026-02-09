import { describe, it, expect } from 'vitest';
import {
  normalizeContent,
  similarityRatio,
  deduplicatePosts,
  mergeResults,
  sortPosts,
  buildMeta,
  parseSources,
  parseTimeframe,
  parseFormat,
  parseSortOrder,
} from '../src/pipeline.js';
import { makePost, makeFetchResult } from './helpers.js';

describe('normalizeContent', () => {
  it('lowercases text', () => {
    expect(normalizeContent('Hello World')).toBe('hello world');
  });

  it('strips URLs', () => {
    expect(normalizeContent('Check https://example.com out')).toBe('check out');
  });

  it('collapses whitespace', () => {
    expect(normalizeContent('hello    world\n\nnewline')).toBe('hello world newline');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeContent('  hello  ')).toBe('hello');
  });

  it('handles all transformations together', () => {
    expect(normalizeContent('  Visit HTTP://foo.com for MORE  info  '))
      .toBe('visit for more info');
  });
});

describe('similarityRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(similarityRatio('hello', 'hello')).toBe(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(similarityRatio('', '')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    expect(similarityRatio('aaaa', 'bbbb')).toBe(0);
  });

  it('returns correct ratio for partial match', () => {
    // 'abc' vs 'axc': positions 0='a' match, 1='b'!='x', 2='c' match → 2/3
    expect(similarityRatio('abc', 'axc')).toBeCloseTo(2 / 3);
  });

  it('handles different length strings', () => {
    // shorter='ab', longer='abc': pos 0 match, pos 1 match → 2/3
    expect(similarityRatio('ab', 'abc')).toBeCloseTo(2 / 3);
  });
});

describe('deduplicatePosts', () => {
  it('keeps all posts from the same source', () => {
    const posts = [
      makePost({ id: '1', source: 'farcaster', content: 'same content here' }),
      makePost({ id: '2', source: 'farcaster', content: 'same content here' }),
    ];
    const result = deduplicatePosts(posts);
    expect(result).toHaveLength(2);
  });

  it('deduplicates identical content across different sources', () => {
    const posts = [
      makePost({ id: '1', source: 'farcaster', content: 'exact same content here for testing' }),
      makePost({ id: '2', source: 'lens', content: 'exact same content here for testing' }),
    ];
    const result = deduplicatePosts(posts);
    expect(result).toHaveLength(1);
  });

  it('keeps post with higher engagement on dedup', () => {
    const posts = [
      makePost({
        id: '1',
        source: 'farcaster',
        content: 'exact same content here for testing purposes',
        engagement: { likes: 5, reposts: 1, replies: 0 },
      }),
      makePost({
        id: '2',
        source: 'lens',
        content: 'exact same content here for testing purposes',
        engagement: { likes: 100, reposts: 50, replies: 20 },
      }),
    ];
    const result = deduplicatePosts(posts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2'); // lens post has higher engagement
  });

  it('does not deduplicate dissimilar content across sources', () => {
    const posts = [
      makePost({ id: '1', source: 'farcaster', content: 'completely different content about farcaster' }),
      makePost({ id: '2', source: 'lens', content: 'totally unique content about lens protocol' }),
    ];
    const result = deduplicatePosts(posts);
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(deduplicatePosts([])).toEqual([]);
  });
});

describe('sortPosts', () => {
  const older = makePost({ id: '1', timestamp: new Date('2025-01-14T12:00:00Z'), engagement: { likes: 100, reposts: 10, replies: 5 } });
  const newer = makePost({ id: '2', timestamp: new Date('2025-01-15T12:00:00Z'), engagement: { likes: 5, reposts: 1, replies: 0 } });
  const highEngagement = makePost({ id: '3', timestamp: new Date('2025-01-13T12:00:00Z'), engagement: { likes: 500, reposts: 100, replies: 50 } });

  it('sorts by recent (newest first)', () => {
    const posts = [older, highEngagement, newer];
    sortPosts(posts, 'recent');
    expect(posts.map(p => p.id)).toEqual(['2', '1', '3']);
  });

  it('sorts by engagement (highest first)', () => {
    const posts = [newer, older, highEngagement];
    sortPosts(posts, 'engagement');
    expect(posts[0].id).toBe('3'); // highest engagement
  });

  it('breaks engagement ties by timestamp', () => {
    const a = makePost({ id: 'a', timestamp: new Date('2025-01-15T12:00:00Z'), engagement: { likes: 10, reposts: 0, replies: 0 } });
    const b = makePost({ id: 'b', timestamp: new Date('2025-01-14T12:00:00Z'), engagement: { likes: 10, reposts: 0, replies: 0 } });
    const posts = [b, a];
    sortPosts(posts, 'engagement');
    expect(posts[0].id).toBe('a'); // same engagement, newer first
  });

  it('sorts by relevance with query — matching posts first', () => {
    const matching = makePost({ id: 'match', content: 'ethereum is great', engagement: { likes: 1, reposts: 0, replies: 0 } });
    const nonMatching = makePost({ id: 'nomatch', content: 'hello world', engagement: { likes: 1000, reposts: 500, replies: 100 } });
    const posts = [nonMatching, matching];
    sortPosts(posts, 'relevance', 'ethereum');
    expect(posts[0].id).toBe('match');
  });

  it('relevance falls back to engagement when no query', () => {
    const low = makePost({ id: 'low', engagement: { likes: 1, reposts: 0, replies: 0 } });
    const high = makePost({ id: 'high', engagement: { likes: 100, reposts: 50, replies: 10 } });
    const posts = [low, high];
    sortPosts(posts, 'relevance');
    expect(posts[0].id).toBe('high');
  });
});

describe('mergeResults', () => {
  it('merges posts from multiple sources', () => {
    const results = [
      makeFetchResult('farcaster', [makePost({ id: '1', source: 'farcaster', content: 'farcaster unique post' })]),
      makeFetchResult('lens', [makePost({ id: '2', source: 'lens', content: 'lens unique post' })]),
    ];
    const merged = mergeResults(results, 'recent');
    expect(merged).toHaveLength(2);
  });

  it('applies deduplication', () => {
    const content = 'this is a duplicated post about ethereum that appears on both';
    const results = [
      makeFetchResult('farcaster', [makePost({ id: '1', source: 'farcaster', content })]),
      makeFetchResult('lens', [makePost({ id: '2', source: 'lens', content })]),
    ];
    const merged = mergeResults(results, 'recent');
    expect(merged).toHaveLength(1);
  });

  it('applies sorting', () => {
    const results = [
      makeFetchResult('farcaster', [
        makePost({ id: '1', source: 'farcaster', content: 'older unique farcaster post', timestamp: new Date('2025-01-14T12:00:00Z') }),
        makePost({ id: '2', source: 'farcaster', content: 'newer unique farcaster post', timestamp: new Date('2025-01-15T12:00:00Z') }),
      ]),
    ];
    const merged = mergeResults(results, 'recent');
    expect(merged[0].id).toBe('2');
  });

  it('handles empty results', () => {
    const results = [
      makeFetchResult('farcaster', []),
      makeFetchResult('lens', []),
    ];
    const merged = mergeResults(results, 'engagement');
    expect(merged).toEqual([]);
  });
});

describe('buildMeta', () => {
  it('computes totalPosts from all results', () => {
    const results = [
      makeFetchResult('farcaster', [makePost({ id: '1' }), makePost({ id: '2' })]),
      makeFetchResult('lens', [makePost({ id: '3' })]),
    ];
    const meta = buildMeta(results, { sources: ['farcaster', 'lens'], timeframe: '24h' });
    expect(meta.totalPosts).toBe(3);
  });

  it('includes source counts', () => {
    const results = [
      makeFetchResult('farcaster', [makePost({ id: '1' })]),
      makeFetchResult('lens', [makePost({ id: '2' }), makePost({ id: '3' })]),
    ];
    const meta = buildMeta(results, { sources: ['farcaster', 'lens'], timeframe: '24h' });
    expect(meta.sources).toEqual([
      { name: 'farcaster', count: 1, error: undefined },
      { name: 'lens', count: 2, error: undefined },
    ]);
  });

  it('includes errors', () => {
    const results = [
      makeFetchResult('nostr', [], 'timeout'),
    ];
    const meta = buildMeta(results, { sources: ['nostr'], timeframe: '24h' });
    expect(meta.sources[0].error).toBe('timeout');
  });

  it('includes query when provided', () => {
    const results = [makeFetchResult('farcaster', [])];
    const meta = buildMeta(results, { query: 'ethereum', sources: ['farcaster'], timeframe: '24h' });
    expect(meta.query).toBe('ethereum');
  });

  it('includes timeframe', () => {
    const results = [makeFetchResult('farcaster', [])];
    const meta = buildMeta(results, { sources: ['farcaster'], timeframe: '48h' });
    expect(meta.timeframe).toBe('48h');
  });

  it('includes fetchedAt as ISO string', () => {
    const results = [makeFetchResult('farcaster', [])];
    const meta = buildMeta(results, { sources: ['farcaster'], timeframe: '24h' });
    expect(() => new Date(meta.fetchedAt)).not.toThrow();
    expect(meta.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('parseSources', () => {
  it('parses comma-separated sources', () => {
    expect(parseSources('farcaster,lens,nostr,bluesky')).toEqual(['farcaster', 'lens', 'nostr', 'bluesky']);
  });

  it('handles spaces', () => {
    expect(parseSources('farcaster, lens, nostr, bluesky')).toEqual(['farcaster', 'lens', 'nostr', 'bluesky']);
  });

  it('filters invalid sources', () => {
    expect(parseSources('farcaster,twitter,lens')).toEqual(['farcaster', 'lens']);
  });

  it('handles single source', () => {
    expect(parseSources('bluesky')).toEqual(['bluesky']);
  });

  it('is case-insensitive', () => {
    expect(parseSources('FARCASTER,Lens')).toEqual(['farcaster', 'lens']);
  });

  it('returns empty for all invalid', () => {
    expect(parseSources('twitter,mastodon')).toEqual([]);
  });
});

describe('parseTimeframe', () => {
  it('parses valid timeframes', () => {
    expect(parseTimeframe('24h')).toBe('24h');
    expect(parseTimeframe('48h')).toBe('48h');
    expect(parseTimeframe('week')).toBe('week');
  });

  it('defaults to 24h for invalid input', () => {
    expect(parseTimeframe('1h')).toBe('24h');
    expect(parseTimeframe('month')).toBe('24h');
  });

  it('is case-insensitive', () => {
    expect(parseTimeframe('WEEK')).toBe('week');
  });
});

describe('parseFormat', () => {
  it('parses valid formats', () => {
    expect(parseFormat('json')).toBe('json');
    expect(parseFormat('markdown')).toBe('markdown');
    expect(parseFormat('summary')).toBe('summary');
    expect(parseFormat('compact')).toBe('compact');
  });

  it('defaults to markdown for invalid input', () => {
    expect(parseFormat('xml')).toBe('markdown');
    expect(parseFormat('csv')).toBe('markdown');
  });

  it('is case-insensitive', () => {
    expect(parseFormat('JSON')).toBe('json');
    expect(parseFormat('COMPACT')).toBe('compact');
  });
});

describe('parseSortOrder', () => {
  it('parses valid sort orders', () => {
    expect(parseSortOrder('engagement')).toBe('engagement');
    expect(parseSortOrder('recent')).toBe('recent');
    expect(parseSortOrder('relevance')).toBe('relevance');
  });

  it('defaults to engagement for invalid input', () => {
    expect(parseSortOrder('alphabetical')).toBe('engagement');
    expect(parseSortOrder('random')).toBe('engagement');
  });

  it('is case-insensitive', () => {
    expect(parseSortOrder('RECENT')).toBe('recent');
    expect(parseSortOrder('Relevance')).toBe('relevance');
  });
});
