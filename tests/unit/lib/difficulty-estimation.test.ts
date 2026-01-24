import { describe, it, expect } from 'vitest';
import { parseDifficultyLabel } from '../../../src/lib/cloister/complexity.js';

describe('parseDifficultyLabel', () => {
  it('should extract difficulty from valid difficulty label', () => {
    expect(parseDifficultyLabel(['difficulty:trivial'])).toBe('trivial');
    expect(parseDifficultyLabel(['difficulty:simple'])).toBe('simple');
    expect(parseDifficultyLabel(['difficulty:medium'])).toBe('medium');
    expect(parseDifficultyLabel(['difficulty:complex'])).toBe('complex');
    expect(parseDifficultyLabel(['difficulty:expert'])).toBe('expert');
  });

  it('should return null when no difficulty label present', () => {
    expect(parseDifficultyLabel(['bug', 'feature'])).toBe(null);
    expect(parseDifficultyLabel([])).toBe(null);
  });

  it('should return null for invalid difficulty level', () => {
    expect(parseDifficultyLabel(['difficulty:invalid'])).toBe(null);
    expect(parseDifficultyLabel(['difficulty:hard'])).toBe(null);
    expect(parseDifficultyLabel(['difficulty:'])).toBe(null);
  });

  it('should handle multiple labels and find difficulty', () => {
    expect(parseDifficultyLabel(['bug', 'difficulty:medium', 'urgent'])).toBe('medium');
    expect(parseDifficultyLabel(['PAN-75', 'linear', 'difficulty:complex'])).toBe('complex');
  });

  it('should use first difficulty label if multiple present', () => {
    expect(parseDifficultyLabel(['difficulty:simple', 'difficulty:complex'])).toBe('simple');
  });

  it('should be case-sensitive for difficulty level', () => {
    expect(parseDifficultyLabel(['difficulty:Medium'])).toBe(null);
    expect(parseDifficultyLabel(['difficulty:SIMPLE'])).toBe(null);
  });
});
