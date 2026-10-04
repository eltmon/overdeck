import { describe, expect, it } from 'vitest';
import { buildDiffFetchUrl } from '../diffRouteSearch';

describe('buildDiffFetchUrl (PAN-4503)', () => {
  it('returns the base unchanged without params', () => {
    expect(buildDiffFetchUrl('/x', {})).toBe('/x');
  });

  it('encodes the file and ignoreWhitespace params', () => {
    expect(buildDiffFetchUrl('/x', { file: 'a b.ts', ignoreWhitespace: '1' })).toBe('/x?file=a+b.ts&ignoreWhitespace=1');
  });

  it('drops null, undefined and empty values', () => {
    expect(buildDiffFetchUrl('/x', { file: null, ignoreWhitespace: undefined, mode: '' })).toBe('/x');
    expect(buildDiffFetchUrl('/x', { file: 'a.ts', ignoreWhitespace: null })).toBe('/x?file=a.ts');
  });
});
