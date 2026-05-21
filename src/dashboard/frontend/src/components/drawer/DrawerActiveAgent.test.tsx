import { describe, expect, it } from 'vitest';

import { classifyStreamLine } from './DrawerActiveAgent';

describe('classifyStreamLine', () => {
  it('classifies error glyphs and keywords as err', () => {
    expect(classifyStreamLine('✗ test failed')).toBe('err');
    expect(classifyStreamLine('something raised an ERROR')).toBe('err');
    expect(classifyStreamLine('compilation FAIL')).toBe('err');
  });

  it('classifies warning glyphs and keywords as warn', () => {
    expect(classifyStreamLine('! review changes requested')).toBe('warn');
    expect(classifyStreamLine('WARN: stale cache hit')).toBe('warn');
  });

  it('classifies success glyphs and keywords as ok', () => {
    expect(classifyStreamLine('✓ all tests pass')).toBe('ok');
    expect(classifyStreamLine('OK now ready')).toBe('ok');
    expect(classifyStreamLine('build PASS')).toBe('ok');
    expect(classifyStreamLine('compile done')).toBe('ok');
  });

  it('classifies arrow/bullet glyphs as verb-line', () => {
    expect(classifyStreamLine('→ implementing bead 4')).toBe('verb-line');
    expect(classifyStreamLine('▸ entering review phase')).toBe('verb-line');
    expect(classifyStreamLine('✱ thinking...')).toBe('verb-line');
  });

  it('falls back to neutral for unclassified lines', () => {
    expect(classifyStreamLine('Reading file foo.ts')).toBe('neutral');
    expect(classifyStreamLine('')).toBe('neutral');
  });

  it('err beats warn beats ok beats verb-line in precedence', () => {
    expect(classifyStreamLine('→ ERROR detected')).toBe('err');
    expect(classifyStreamLine('→ WARN cache stale')).toBe('warn');
    expect(classifyStreamLine('→ done')).toBe('ok');
  });
});
