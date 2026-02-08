import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTimeframeCutoff, formatTimeAgo } from '../src/utils/time.js';

describe('getTimeframeCutoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a date 24h ago for "24h"', () => {
    vi.useFakeTimers();
    const now = new Date('2025-06-15T12:00:00Z');
    vi.setSystemTime(now);

    const cutoff = getTimeframeCutoff('24h');
    expect(cutoff.getTime()).toBe(now.getTime() - 24 * 60 * 60 * 1000);
  });

  it('returns a date 48h ago for "48h"', () => {
    vi.useFakeTimers();
    const now = new Date('2025-06-15T12:00:00Z');
    vi.setSystemTime(now);

    const cutoff = getTimeframeCutoff('48h');
    expect(cutoff.getTime()).toBe(now.getTime() - 48 * 60 * 60 * 1000);
  });

  it('returns a date 7 days ago for "week"', () => {
    vi.useFakeTimers();
    const now = new Date('2025-06-15T12:00:00Z');
    vi.setSystemTime(now);

    const cutoff = getTimeframeCutoff('week');
    expect(cutoff.getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  });
});

describe('formatTimeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:30Z'));

    const date = new Date('2025-06-15T12:00:00Z');
    expect(formatTimeAgo(date)).toBe('30s ago');
  });

  it('formats minutes ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:05:00Z'));

    const date = new Date('2025-06-15T12:00:00Z');
    expect(formatTimeAgo(date)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T15:00:00Z'));

    const date = new Date('2025-06-15T12:00:00Z');
    expect(formatTimeAgo(date)).toBe('3h ago');
  });

  it('formats days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-18T12:00:00Z'));

    const date = new Date('2025-06-15T12:00:00Z');
    expect(formatTimeAgo(date)).toBe('3d ago');
  });
});
