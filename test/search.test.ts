import { describe, it, expect } from 'vitest';
import { matchesQuery } from '../src/utils/search.js';

describe('matchesQuery', () => {
  describe('single-word queries', () => {
    it('matches when content contains the term', () => {
      expect(matchesQuery('Hello world of crypto', [], 'crypto')).toBe(true);
    });

    it('does not match when content lacks the term', () => {
      expect(matchesQuery('Hello world', [], 'crypto')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(matchesQuery('Ethereum is great', [], 'ethereum')).toBe(true);
      expect(matchesQuery('ethereum is great', [], 'ETHEREUM')).toBe(true);
    });
  });

  describe('multi-word queries (AND semantics)', () => {
    it('matches when all terms are present', () => {
      expect(matchesQuery('AI and crypto are converging', [], 'AI crypto')).toBe(true);
    });

    it('does not match when only some terms are present', () => {
      expect(matchesQuery('AI is amazing', [], 'AI crypto')).toBe(false);
    });

    it('matches terms in any order', () => {
      expect(matchesQuery('crypto and AI', [], 'AI crypto')).toBe(true);
    });

    it('handles three or more terms', () => {
      expect(matchesQuery('AI crypto ethereum layer2', [], 'AI crypto ethereum')).toBe(true);
      expect(matchesQuery('AI crypto', [], 'AI crypto ethereum')).toBe(false);
    });
  });

  describe('tag matching', () => {
    it('matches a term found in tags but not content', () => {
      expect(matchesQuery('some post content', ['ethereum', 'defi'], 'ethereum')).toBe(true);
    });

    it('matches with mixed content and tag hits across terms', () => {
      expect(matchesQuery('AI is the future', ['crypto'], 'AI crypto')).toBe(true);
    });

    it('is case-insensitive for tags', () => {
      expect(matchesQuery('hello', ['Ethereum'], 'ethereum')).toBe(true);
    });

    it('uses partial tag matching', () => {
      expect(matchesQuery('hello', ['ethereum-layer2'], 'layer2')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns true for empty query', () => {
      expect(matchesQuery('anything', [], '')).toBe(true);
    });

    it('returns true for whitespace-only query', () => {
      expect(matchesQuery('anything', [], '   ')).toBe(true);
    });

    it('handles empty content', () => {
      expect(matchesQuery('', [], 'test')).toBe(false);
    });

    it('handles empty content with matching tag', () => {
      expect(matchesQuery('', ['test'], 'test')).toBe(true);
    });
  });
});
