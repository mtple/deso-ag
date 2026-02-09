import { normalizeContent } from './pipeline.js';
import { computeEngagementScore } from './formatters/output.js';
import type { Post, Source, Term, SourceTerms, TermsResult } from './types.js';

export const STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
  'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
  'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no',
  'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
  'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
  'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
  'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'are', 'has', 'was', 'been', 'is',
  'am', 'were', 'did', 'had', 'does', 'being', 'got', 'really',
  'very', 'much', 'more', 'too', 'still', 'own', 'here', 'why',
  'don', 'didn', 'isn', 'aren', 'won', 'wouldn', 'shouldn', 'couldn',
  'let', 'thing', 'things', 'lot', 'going', 'need', 'right', 'big',
  'long', 'man', 'old', 'great', 'little', 'sure', 'keep', 'should',
  'those', 'made', 'said', 'lol', 'yes', 'yeah', 'nah', 'okay', 'actually',
  'every', 'already', 'many', 'may', 'might', 'must', 'though', 'through',
  'while', 'where', 'down', 'off', 'been', 'before', 'between', 'both',
  'each', 'few', 'same', 'such', 'since', 'never', 'always', 'last',
  'again', 'another', 'around', 'part', 'put', 'set', 'per', 'try',
  'doing', 'done', 'getting', 'making', 'something', 'anything', 'everything',
  'nothing', 'someone', 'anyone', 'everyone', 'nobody', 'gonna', 'wanna',
  'gotta', 'ima', 'imo', 'tbh', 'idk',
]);

interface TokenEntry {
  weight: number;
  postIds: Set<string>;
}

/**
 * Strip punctuation and possessives from normalized text.
 */
function stripPunctuation(text: string): string {
  return text
    .replace(/'s\b/g, '')      // possessives
    .replace(/[^\w\s]/g, ' ')  // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize text into unigrams and bigrams.
 * Returns arrays of tokens (lowercased strings).
 */
export function tokenize(text: string): { unigrams: string[]; bigrams: string[] } {
  const clean = stripPunctuation(text);
  const words = clean.split(' ').filter(w => w.length >= 3);

  const unigrams = words.filter(w => !STOP_WORDS.has(w));

  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    // Skip bigrams where both words are stop words
    if (STOP_WORDS.has(words[i]) && STOP_WORDS.has(words[i + 1])) continue;
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }

  return { unigrams, bigrams };
}

/**
 * Extract top N terms from a list of posts using engagement-weighted
 * word/bigram frequency analysis.
 */
export function extractTerms(posts: Post[], topN: number = 3): Term[] {
  const tokenWeights = new Map<string, TokenEntry>();

  for (const post of posts) {
    const normalized = normalizeContent(post.content);

    // Skip short posts (noise like "gm")
    if (normalized.length < 10) continue;

    const engagementScore = computeEngagementScore(post);
    const weight = 1 + Math.log2(1 + engagementScore);

    const { unigrams, bigrams } = tokenize(normalized);

    // Include post.tags as additional unigram tokens
    const tagTokens = (post.tags || []).map(t => t.toLowerCase()).filter(t => t.length >= 3);

    const allUnigrams = [...unigrams, ...tagTokens];

    // Accumulate unigrams
    for (const token of allUnigrams) {
      const entry = tokenWeights.get(token) || { weight: 0, postIds: new Set<string>() };
      entry.weight += weight;
      entry.postIds.add(post.id);
      tokenWeights.set(token, entry);
    }

    // Accumulate bigrams
    for (const token of bigrams) {
      const entry = tokenWeights.get(token) || { weight: 0, postIds: new Set<string>() };
      entry.weight += weight;
      entry.postIds.add(post.id);
      tokenWeights.set(token, entry);
    }
  }

  // Threshold: require >= 2 distinct posts
  const filtered: [string, TokenEntry][] = [];
  for (const [token, entry] of tokenWeights) {
    if (entry.postIds.size >= 2) {
      filtered.push([token, entry]);
    }
  }

  // Sort by score descending, prefer bigrams when scores are equal
  filtered.sort((a, b) => {
    const diff = b[1].weight - a[1].weight;
    if (diff !== 0) return diff;
    // Prefer bigrams over unigrams at equal weight (more specific)
    const aIsBigram = a[0].includes(' ') ? 1 : 0;
    const bIsBigram = b[0].includes(' ') ? 1 : 0;
    return bIsBigram - aIsBigram;
  });

  // Deduplicate: if a bigram ranks higher, suppress its constituent unigrams
  const result: Term[] = [];
  const suppressed = new Set<string>();

  for (const [token, entry] of filtered) {
    if (suppressed.has(token)) continue;

    result.push({
      token,
      score: Math.round(entry.weight * 10) / 10,
      postCount: entry.postIds.size,
    });

    // If this is a bigram, suppress its constituent unigrams
    if (token.includes(' ')) {
      const parts = token.split(' ');
      for (const part of parts) {
        suppressed.add(part);
      }
    }

    if (result.length >= topN) break;
  }

  return result;
}

/**
 * Extract terms grouped by source + overall.
 */
export function extractTermsBySource(
  posts: Post[],
  topN: number = 3,
  timeframe: string = '24h',
): TermsResult {
  // Group by source
  const bySource = new Map<Source, Post[]>();
  for (const post of posts) {
    const existing = bySource.get(post.source) || [];
    existing.push(post);
    bySource.set(post.source, existing);
  }

  const sourceTerms: SourceTerms[] = [];
  for (const [source, sourcePosts] of bySource) {
    sourceTerms.push({
      source,
      postCount: sourcePosts.length,
      terms: extractTerms(sourcePosts, topN),
    });
  }

  // Sort sources in a consistent order
  const sourceOrder: Source[] = ['farcaster', 'lens', 'nostr', 'bluesky'];
  sourceTerms.sort((a, b) => sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source));

  return {
    bySource: sourceTerms,
    overall: extractTerms(posts, topN),
    timeframe,
    analyzedAt: new Date().toISOString(),
  };
}
