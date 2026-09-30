import { describe, expect, it } from 'vitest';

import { classifyChunkMatch, queryTerms } from '../match-context.js';

describe('queryTerms', () => {
  it('lowercases, deduplicates, and splits on non-word boundaries', () => {
    expect(queryTerms('Personal  portfolio portfolio')).toEqual(['personal', 'portfolio']);
  });
});

describe('classifyChunkMatch', () => {
  it('returns text for a prose occurrence', () => {
    expect(classifyChunkMatch('I deployed eltmon.com today', 'eltmon')).toBe('text');
  });

  it('returns path when the only occurrence is inside a path-like token', () => {
    expect(classifyChunkMatch('see /home/eltmon/Projects/x for details', 'eltmon')).toBe('path');
  });

  it('returns path when the only occurrence is inside a terminated fence', () => {
    const text = '```\ndrwx------ 4 eltmon eltmon 4096\n```';
    expect(classifyChunkMatch(text, 'eltmon')).toBe('path');
  });

  it('returns path when the only occurrence is inside an unterminated fence', () => {
    const text = '```\ndrwx------ 4 eltmon eltmon 4096';
    expect(classifyChunkMatch(text, 'eltmon')).toBe('path');
  });

  it('returns path when the only occurrence is inside inline code', () => {
    expect(classifyChunkMatch('run `eltmon` to check', 'eltmon')).toBe('path');
  });

  it('returns path when the only occurrence is inside an <output-file> tag', () => {
    const text = '<output-file>/tmp/claude-1000/-home-eltmon-Projects-lexerra/x</output-file>';
    expect(classifyChunkMatch(text, 'eltmon')).toBe('path');
  });

  it('returns text when one occurrence is in prose and one is in a path', () => {
    const text = 'eltmon deployed the site, see /home/eltmon/Projects/x for the repo';
    expect(classifyChunkMatch(text, 'eltmon')).toBe('text');
  });

  it('returns text when there is no literal occurrence', () => {
    expect(classifyChunkMatch('nothing relevant here', 'eltmon')).toBe('text');
  });
});
