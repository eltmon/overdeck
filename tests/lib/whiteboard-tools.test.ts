import { describe, expect, it, vi } from 'vitest';
import { normalizeElements } from '../../src/autopreso/whiteboard-elements.js';
import { extractKeywords } from '../../src/autopreso/whiteboard-keywords.js';
import { applyWhiteboardEditOperations, formatLineNumberedWhiteboard } from '../../src/autopreso/whiteboard-tools.js';

const canvas = normalizeElements([
  { id: 'a', type: 'rectangle', x: 100, y: 200, width: 40, height: 30, text: 'Box A' },
  { id: 'b', type: 'ellipse', x: 200, y: 250, width: 50, height: 50 },
  { id: 'c', type: 'text', x: 300, y: 300, width: 80, height: 20, text: 'Launch Plan' },
]);

describe('normalizeElements', () => {
  it('fills required Excalidraw fields and warns for impossible coordinates', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [element] = normalizeElements([{ x: 200000 }]);

    expect(element).toMatchObject({ type: 'rectangle', x: 200000, y: 0, width: 100, height: 100, version: 1 });
    expect(element.id).toEqual(expect.any(String));
    expect(element.versionNonce).toEqual(expect.any(Number));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('whiteboard edit operations', () => {
  it('formats line-numbered whiteboard content', () => {
    expect(formatLineNumberedWhiteboard(canvas)).toContain('1: rectangle text="Box A" at (100,200)');
  });

  it('replaces, inserts, and deletes elements by line number', () => {
    const next = applyWhiteboardEditOperations(canvas, [
      { action: 'replace', lineNumber: 1, element: { text: 'Box B' } },
      { action: 'insert_after', lineNumber: 2, element: { id: 'd', type: 'diamond', x: 10, y: 20 } },
      { action: 'delete', lineNumber: 4 },
    ]);

    expect(next.map((element) => element.id)).toEqual(['a', 'b', 'd']);
    expect(next[0].text).toBe('Box B');
  });
});

describe('extractKeywords', () => {
  it('returns text strings from text elements and bound shape labels', () => {
    const elements = normalizeElements([
      { id: 'shape', type: 'rectangle', x: 0, y: 0, boundElements: [{ id: 'label', type: 'text' }] },
      { id: 'label', type: 'text', x: 0, y: 0, text: 'Revenue Model' },
    ]);

    expect(extractKeywords(elements)).toEqual(['Revenue Model']);
  });
});
