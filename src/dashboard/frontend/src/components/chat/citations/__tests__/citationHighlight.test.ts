import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearRowCitationRanges, findQuoteRange, setRowCitationRanges } from '../citationHighlight.js';

describe('findQuoteRange', () => {
  it('finds a quote that spans two elements', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Hello <strong>wide</strong> world</p>';
    document.body.appendChild(root);

    const range = findQuoteRange(root, 'Hello wide\nworld');
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('Hello wide world');

    root.remove();
  });

  it('returns null when the quote text is not present', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Nothing matches here</p>';
    document.body.appendChild(root);

    expect(findQuoteRange(root, 'missing quote')).toBeNull();

    root.remove();
  });

  it('returns null for a whitespace-only quote', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Some text</p>';
    expect(findQuoteRange(root, '   \n  ')).toBeNull();
  });
});

describe('setRowCitationRanges / clearRowCitationRanges', () => {
  class FakeHighlight {
    ranges: Range[];
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }

  let highlightsMap: Map<string, FakeHighlight>;

  beforeEach(() => {
    highlightsMap = new Map();
    vi.stubGlobal('CSS', { highlights: highlightsMap });
    vi.stubGlobal('Highlight', FakeHighlight);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearRowCitationRanges('conv-a:msg-1');
    clearRowCitationRanges('conv-a:msg-2');
  });

  function fakeRange(): Range {
    const node = document.createTextNode('text');
    document.body.appendChild(node);
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 4);
    return range;
  }

  it('registers the overdeck-citation highlight when ranges are set', () => {
    setRowCitationRanges('conv-a:msg-1', [fakeRange()]);
    expect(highlightsMap.has('overdeck-citation')).toBe(true);
    expect((highlightsMap.get('overdeck-citation') as unknown as FakeHighlight).ranges).toHaveLength(1);
  });

  it('deletes the highlight once the last row clears its ranges', () => {
    setRowCitationRanges('conv-a:msg-1', [fakeRange()]);
    setRowCitationRanges('conv-a:msg-2', [fakeRange()]);
    expect(highlightsMap.has('overdeck-citation')).toBe(true);

    clearRowCitationRanges('conv-a:msg-1');
    expect(highlightsMap.has('overdeck-citation')).toBe(true);

    clearRowCitationRanges('conv-a:msg-2');
    expect(highlightsMap.has('overdeck-citation')).toBe(false);
  });

  it('does nothing without the CSS Custom Highlight API', () => {
    vi.unstubAllGlobals();
    expect(() => setRowCitationRanges('conv-a:msg-1', [fakeRange()])).not.toThrow();
    expect(() => clearRowCitationRanges('conv-a:msg-1')).not.toThrow();
  });
});
