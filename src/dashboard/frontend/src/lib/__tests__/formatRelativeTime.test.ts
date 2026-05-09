import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../formatRelativeTime';

function makeNow(isoString: string): Date {
  return new Date(isoString);
}

const NOW = makeNow('2026-04-12T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('returns empty string for null', () => {
    expect(formatRelativeTime(null, NOW)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatRelativeTime(undefined, NOW)).toBe('');
  });

  it('returns empty string for an invalid date string', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });

  it('returns "just now" for < 5s ago', () => {
    const date = new Date(NOW.getTime() - 3_000); // 3s ago
    expect(formatRelativeTime(date, NOW)).toBe('just now');
  });

  it('returns "just now" for 0s ago (same instant)', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
  });

  it('returns "Xs ago" for 5s–59s ago', () => {
    const thirtyS = new Date(NOW.getTime() - 30_000);
    expect(formatRelativeTime(thirtyS, NOW)).toBe('30s ago');
    const fiftyNineS = new Date(NOW.getTime() - 59_000);
    expect(formatRelativeTime(fiftyNineS, NOW)).toBe('59s ago');
  });

  it('returns minutes for 1m–59m ago', () => {
    const twoMin = new Date(NOW.getTime() - 2 * 60_000);
    expect(formatRelativeTime(twoMin, NOW)).toBe('2m ago');

    const fiftyNineMin = new Date(NOW.getTime() - 59 * 60_000);
    expect(formatRelativeTime(fiftyNineMin, NOW)).toBe('59m ago');
  });

  it('returns hours for 1h–23h ago', () => {
    const oneHour = new Date(NOW.getTime() - 60 * 60_000);
    expect(formatRelativeTime(oneHour, NOW)).toBe('1h ago');

    const twentyThreeHours = new Date(NOW.getTime() - 23 * 60 * 60_000);
    expect(formatRelativeTime(twentyThreeHours, NOW)).toBe('23h ago');
  });

  it('returns "yesterday" for exactly 1 day ago', () => {
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60_000);
    expect(formatRelativeTime(yesterday, NOW)).toBe('yesterday');
  });

  it('returns days for 2–6 days ago', () => {
    const twoDays = new Date(NOW.getTime() - 2 * 24 * 60 * 60_000);
    expect(formatRelativeTime(twoDays, NOW)).toBe('2d ago');

    const sixDays = new Date(NOW.getTime() - 6 * 24 * 60 * 60_000);
    expect(formatRelativeTime(sixDays, NOW)).toBe('6d ago');
  });

  it('returns short date (no year) for same-year dates >= 7 days ago', () => {
    // 30 days ago — still in 2026
    const thirtyDays = new Date(NOW.getTime() - 30 * 24 * 60 * 60_000);
    const result = formatRelativeTime(thirtyDays, NOW);
    // Should be something like "Mar 13" — no year
    expect(result).toMatch(/^[A-Z][a-z]+ \d+$/);
    expect(result).not.toContain('2026');
  });

  it('returns date with year for different-year dates', () => {
    const lastYear = new Date('2025-01-05T00:00:00.000Z');
    const result = formatRelativeTime(lastYear, NOW);
    // Should be something like "Jan 5, 2025"
    expect(result).toContain('2025');
  });

  it('accepts ISO string input in addition to Date objects', () => {
    const isoString = new Date(NOW.getTime() - 5 * 60_000).toISOString(); // 5 min ago
    expect(formatRelativeTime(isoString, NOW)).toBe('5m ago');
  });
});
