import { describe, expect, it } from 'vitest';
import { buildDiffFetchUrl, parseDiffRouteSearch, stripDiffSearchParams } from '../diffRouteSearch';

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

describe('compare search params (PAN-4503)', () => {
  it('keeps diffBase, diffHead and diffMode for the compare view', () => {
    expect(parseDiffRouteSearch({ diff: '1', diffTurnId: 'compare', diffBase: 'a', diffHead: 'b', diffMode: 'three-dot' }))
      .toEqual({ diff: '1', diffTurnId: 'compare', diffBase: 'a', diffHead: 'b', diffMode: 'three-dot' });
  });

  it('drops the compare keys for other views', () => {
    expect(parseDiffRouteSearch({ diff: '1', diffTurnId: 'vs-main', diffBase: 'a', diffHead: 'b', diffMode: 'two-dot' }))
      .toEqual({ diff: '1', diffTurnId: 'vs-main' });
  });

  it('drops an unknown diffMode', () => {
    expect(parseDiffRouteSearch({ diff: '1', diffTurnId: 'compare', diffBase: 'a', diffHead: 'b', diffMode: 'bogus' }))
      .toEqual({ diff: '1', diffTurnId: 'compare', diffBase: 'a', diffHead: 'b' });
  });

  it('strips all six diff keys and keeps the rest', () => {
    expect(stripDiffSearchParams({
      diff: '1', diffTurnId: 'compare', diffFilePath: 'a.ts', diffBase: 'a', diffHead: 'b', diffMode: 'two-dot', tab: 'x',
    })).toEqual({ tab: 'x' });
  });
});
