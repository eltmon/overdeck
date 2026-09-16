import { describe, it, expect } from 'vitest';
import { parseRepoUrl } from '../../../../src/lib/projects/repo-url';

describe('parseRepoUrl', () => {
  // AC1: Shorthand format 'o/r'
  it('parses shorthand format o/r', () => {
    const result = parseRepoUrl('o/r');
    expect(result.cloneUrl).toBe('https://github.com/o/r.git');
    expect(result.provider).toBe('github');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
  });

  // AC2: SCP-like git@host:path formats
  it('parses git@gitlab.com:g/sub/r.git', () => {
    const result = parseRepoUrl('git@gitlab.com:g/sub/r.git');
    expect(result.provider).toBe('gitlab');
    expect(result.slug).toBe('g/sub/r');
    expect(result.folderName).toBe('r');
    expect(result.cloneUrl).toBe('https://gitlab.com/g/sub/r.git');
  });

  it('parses git@gitlab.com:g/sub/r (without .git)', () => {
    const result = parseRepoUrl('git@gitlab.com:g/sub/r');
    expect(result.provider).toBe('gitlab');
    expect(result.slug).toBe('g/sub/r');
    expect(result.folderName).toBe('r');
  });

  it('parses ssh://git@github.com/o/r.git', () => {
    const result = parseRepoUrl('ssh://git@github.com/o/r.git');
    expect(result.provider).toBe('github');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
  });

  it('parses ssh://git@github.com/o/r (without .git)', () => {
    const result = parseRepoUrl('ssh://git@github.com/o/r');
    expect(result.provider).toBe('github');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
  });

  // AC3: HTTPS URLs with normalization
  it('parses https://github.com/o/r/ (trailing slash)', () => {
    const result = parseRepoUrl('https://github.com/o/r/');
    expect(result.cloneUrl).toBe('https://github.com/o/r.git');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
  });

  it('parses https://github.com/o/r.git', () => {
    const result = parseRepoUrl('https://github.com/o/r.git');
    expect(result.cloneUrl).toBe('https://github.com/o/r.git');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
  });

  it('parses https://github.com/o/r (no extension)', () => {
    const result = parseRepoUrl('https://github.com/o/r');
    expect(result.cloneUrl).toBe('https://github.com/o/r.git');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
  });

  // AC4: Bare word returns all nulls
  it('returns null for bare word orca', () => {
    const result = parseRepoUrl('orca');
    expect(result.provider).toBeNull();
    expect(result.slug).toBeNull();
    expect(result.folderName).toBeNull();
    expect(result.cloneUrl).toBeNull();
  });

  // AC4: Unknown host preserves cloneUrl but nulls provider/slug
  it('handles unknown host https://example.com/x/y.git', () => {
    const result = parseRepoUrl('https://example.com/x/y.git');
    expect(result.cloneUrl).toBe('https://example.com/x/y.git');
    expect(result.provider).toBeNull();
    expect(result.slug).toBeNull();
    expect(result.folderName).toBeNull();
  });

  it('handles unknown host git@custom.host:x/y', () => {
    const result = parseRepoUrl('git@custom.host:x/y');
    expect(result.cloneUrl).toBe('ssh://git@custom.host/x/y');
    expect(result.provider).toBeNull();
    expect(result.slug).toBeNull();
    expect(result.folderName).toBeNull();
  });

  // Additional edge cases
  it('handles empty string', () => {
    const result = parseRepoUrl('');
    expect(result.provider).toBeNull();
    expect(result.slug).toBeNull();
    expect(result.folderName).toBeNull();
    expect(result.cloneUrl).toBeNull();
  });

  it('handles whitespace-only input', () => {
    const result = parseRepoUrl('   ');
    expect(result.provider).toBeNull();
    expect(result.slug).toBeNull();
    expect(result.folderName).toBeNull();
    expect(result.cloneUrl).toBeNull();
  });

  it('parses gitlab shorthand g/r', () => {
    const result = parseRepoUrl('g/r');
    // Shorthand always assumes github
    expect(result.provider).toBe('github');
    expect(result.cloneUrl).toBe('https://github.com/g/r.git');
    expect(result.slug).toBe('g/r');
    expect(result.folderName).toBe('r');
  });

  it('parses shorthand with .git o/r.git', () => {
    const result = parseRepoUrl('o/r.git');
    expect(result.cloneUrl).toBe('https://github.com/o/r.git');
    expect(result.provider).toBe('github');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
  });

  it('parses https://gitlab.com/path/to/repo', () => {
    const result = parseRepoUrl('https://gitlab.com/path/to/repo');
    expect(result.provider).toBe('gitlab');
    expect(result.slug).toBe('path/to/repo');
    expect(result.folderName).toBe('repo');
    expect(result.cloneUrl).toBe('https://gitlab.com/path/to/repo.git');
  });

  it('parses git@github.com:o/r', () => {
    const result = parseRepoUrl('git@github.com:o/r');
    expect(result.provider).toBe('github');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
    expect(result.cloneUrl).toBe('https://github.com/o/r.git');
  });

  it('trims whitespace from input', () => {
    const result = parseRepoUrl('  o/r  ');
    expect(result.provider).toBe('github');
    expect(result.slug).toBe('o/r');
    expect(result.folderName).toBe('r');
    expect(result.cloneUrl).toBe('https://github.com/o/r.git');
  });
});
