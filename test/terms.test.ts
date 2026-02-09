import { describe, it, expect } from 'vitest';
import { tokenize, extractTerms, extractTermsBySource, STOP_WORDS } from '../src/terms.js';
import { makePost } from './helpers.js';

describe('tokenize', () => {
  it('extracts unigrams >= 3 chars', () => {
    const { unigrams } = tokenize('the big ethereum network');
    expect(unigrams).toContain('ethereum');
    expect(unigrams).toContain('network');
    // "big" is a stop word, "the" is a stop word
    expect(unigrams).not.toContain('the');
    expect(unigrams).not.toContain('big');
  });

  it('filters out words shorter than 3 chars', () => {
    const { unigrams } = tokenize('go to an ethereum tx');
    expect(unigrams).toContain('ethereum');
    expect(unigrams).not.toContain('go');
    expect(unigrams).not.toContain('to');
    expect(unigrams).not.toContain('an');
    expect(unigrams).not.toContain('tx');
  });

  it('generates bigrams', () => {
    const { bigrams } = tokenize('base chain scaling solutions');
    expect(bigrams).toContain('base chain');
    expect(bigrams).toContain('chain scaling');
    expect(bigrams).toContain('scaling solutions');
  });

  it('skips bigrams where both words are stop words', () => {
    const { bigrams } = tokenize('the big ethereum network');
    // "the big" should be skipped (both stop words)
    expect(bigrams).not.toContain('the big');
    // "big ethereum" should be included (ethereum is not a stop word)
    expect(bigrams).toContain('big ethereum');
  });

  it('strips punctuation', () => {
    const { unigrams } = tokenize('ethereum, bitcoin! defi?');
    expect(unigrams).toContain('ethereum');
    expect(unigrams).toContain('bitcoin');
    expect(unigrams).toContain('defi');
  });

  it('strips possessives', () => {
    const { unigrams } = tokenize("ethereum's scalability");
    expect(unigrams).toContain('ethereum');
    expect(unigrams).toContain('scalability');
    expect(unigrams).not.toContain("ethereum's");
  });

  it('returns empty arrays for empty input', () => {
    const { unigrams, bigrams } = tokenize('');
    expect(unigrams).toEqual([]);
    expect(bigrams).toEqual([]);
  });
});

describe('extractTerms', () => {
  it('returns empty array for no posts', () => {
    expect(extractTerms([])).toEqual([]);
  });

  it('skips posts with < 10 chars normalized content', () => {
    const posts = [
      makePost({ id: '1', content: 'gm' }),
      makePost({ id: '2', content: 'hey' }),
    ];
    expect(extractTerms(posts)).toEqual([]);
  });

  it('requires tokens to appear in >= 2 distinct posts', () => {
    const posts = [
      makePost({ id: '1', content: 'ethereum is the future of decentralized finance' }),
    ];
    // Only 1 post, so nothing meets the threshold
    expect(extractTerms(posts)).toEqual([]);
  });

  it('extracts top terms by engagement-weighted frequency', () => {
    const posts = [
      makePost({ id: '1', content: 'bitcoin lightning network is amazing for payments', engagement: { likes: 10, reposts: 5, replies: 2 } }),
      makePost({ id: '2', content: 'bitcoin and lightning adoption is growing fast', engagement: { likes: 20, reposts: 10, replies: 5 } }),
      makePost({ id: '3', content: 'bitcoin price hitting new highs this week', engagement: { likes: 5, reposts: 1, replies: 0 } }),
    ];
    const terms = extractTerms(posts, 3);
    expect(terms.length).toBeGreaterThan(0);
    // bitcoin should be the top term (appears in all 3 posts)
    expect(terms[0].token).toBe('bitcoin');
    expect(terms[0].postCount).toBe(3);
  });

  it('applies logarithmic engagement weighting', () => {
    const posts = [
      makePost({ id: '1', content: 'ethereum scaling solutions are here', engagement: { likes: 1000, reposts: 500, replies: 200 } }),
      makePost({ id: '2', content: 'ethereum layer two solutions growing', engagement: { likes: 1, reposts: 0, replies: 0 } }),
    ];
    const terms = extractTerms(posts, 3);
    const ethTerm = terms.find(t => t.token === 'ethereum');
    expect(ethTerm).toBeDefined();
    // The viral post shouldn't completely dominate due to log weighting
    // score = weight_post1 + weight_post2 where weight = 1 + log2(1 + engagementScore)
    // post1: engagement = 1000 + 500*2 + 200 = 2200, weight = 1 + log2(2201) ≈ 12.1
    // post2: engagement = 1, weight = 1 + log2(2) = 2
    // total ≈ 14.1
    expect(ethTerm!.score).toBeGreaterThan(10);
    expect(ethTerm!.score).toBeLessThan(20);
  });

  it('includes tags as unigram tokens', () => {
    const posts = [
      makePost({ id: '1', content: 'check out this new protocol for trading', tags: ['defi', 'eth'] }),
      makePost({ id: '2', content: 'another great protocol for decentralized apps', tags: ['defi'] }),
    ];
    const terms = extractTerms(posts, 5);
    const defiTerm = terms.find(t => t.token === 'defi');
    expect(defiTerm).toBeDefined();
    expect(defiTerm!.postCount).toBe(2);
  });

  it('suppresses unigrams when bigram ranks higher', () => {
    const posts = [
      makePost({ id: '1', content: 'base chain is the future of layer two scaling', engagement: { likes: 50, reposts: 20, replies: 10 } }),
      makePost({ id: '2', content: 'base chain transactions are cheap and fast', engagement: { likes: 40, reposts: 15, replies: 8 } }),
      makePost({ id: '3', content: 'base chain ecosystem is growing rapidly now', engagement: { likes: 30, reposts: 10, replies: 5 } }),
    ];
    const terms = extractTerms(posts, 5);
    const bigramTerm = terms.find(t => t.token === 'base chain');
    expect(bigramTerm).toBeDefined();
    // "base" and "chain" as individual unigrams should be suppressed
    const baseTerm = terms.find(t => t.token === 'base');
    const chainTerm = terms.find(t => t.token === 'chain');
    expect(baseTerm).toBeUndefined();
    expect(chainTerm).toBeUndefined();
  });

  it('respects topN parameter', () => {
    const posts = [
      makePost({ id: '1', content: 'bitcoin ethereum solana defi nfts governance protocol staking', engagement: { likes: 10 } }),
      makePost({ id: '2', content: 'bitcoin ethereum solana defi nfts governance protocol staking', engagement: { likes: 10 } }),
    ];
    const terms = extractTerms(posts, 2);
    expect(terms.length).toBeLessThanOrEqual(2);
  });

  it('defaults to top 3', () => {
    const posts = [
      makePost({ id: '1', content: 'bitcoin ethereum solana defi nfts governance protocol staking', engagement: { likes: 10 } }),
      makePost({ id: '2', content: 'bitcoin ethereum solana defi nfts governance protocol staking', engagement: { likes: 10 } }),
    ];
    const terms = extractTerms(posts);
    expect(terms.length).toBeLessThanOrEqual(3);
  });
});

describe('extractTermsBySource', () => {
  it('groups terms by source', () => {
    const posts = [
      makePost({ id: '1', source: 'farcaster', content: 'bitcoin is great for decentralized payments' }),
      makePost({ id: '2', source: 'farcaster', content: 'bitcoin adoption is growing across the world' }),
      makePost({ id: '3', source: 'nostr', content: 'lightning zaps are the best feature ever made' }),
      makePost({ id: '4', source: 'nostr', content: 'lightning network zaps enable instant payments' }),
    ];
    const result = extractTermsBySource(posts, 3);
    expect(result.bySource).toHaveLength(2);

    const farcaster = result.bySource.find(s => s.source === 'farcaster');
    expect(farcaster).toBeDefined();
    expect(farcaster!.postCount).toBe(2);

    const nostr = result.bySource.find(s => s.source === 'nostr');
    expect(nostr).toBeDefined();
    expect(nostr!.postCount).toBe(2);
  });

  it('includes overall terms across all sources', () => {
    const posts = [
      makePost({ id: '1', source: 'farcaster', content: 'bitcoin is the future of money and finance' }),
      makePost({ id: '2', source: 'nostr', content: 'bitcoin lightning network enables fast payments' }),
    ];
    const result = extractTermsBySource(posts, 3);
    expect(result.overall.length).toBeGreaterThan(0);
  });

  it('includes timeframe and analyzedAt', () => {
    const result = extractTermsBySource([], 3, 'week');
    expect(result.timeframe).toBe('week');
    expect(result.analyzedAt).toBeDefined();
  });

  it('sorts sources in consistent order: farcaster, lens, nostr, bluesky', () => {
    const posts = [
      makePost({ id: '1', source: 'nostr', content: 'nostr protocol is evolving rapidly today' }),
      makePost({ id: '2', source: 'nostr', content: 'nostr events are being relayed everywhere' }),
      makePost({ id: '3', source: 'farcaster', content: 'farcaster frames are really cool stuff' }),
      makePost({ id: '4', source: 'farcaster', content: 'farcaster frames enable new interactions' }),
      makePost({ id: '5', source: 'lens', content: 'lens protocol governance is improving fast' }),
      makePost({ id: '6', source: 'lens', content: 'lens protocol upgrades are coming soon' }),
      makePost({ id: '7', source: 'bluesky', content: 'bluesky atproto federation is growing fast' }),
      makePost({ id: '8', source: 'bluesky', content: 'bluesky atproto custom feeds are great' }),
    ];
    const result = extractTermsBySource(posts, 3);
    expect(result.bySource[0].source).toBe('farcaster');
    expect(result.bySource[1].source).toBe('lens');
    expect(result.bySource[2].source).toBe('nostr');
    expect(result.bySource[3].source).toBe('bluesky');
  });
});
