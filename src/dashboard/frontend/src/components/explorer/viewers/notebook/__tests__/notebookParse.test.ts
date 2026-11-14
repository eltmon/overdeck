/** PAN-5189 WI-12: openNotebook reads v4 notebooks and rejects anything else. */
import { describe, expect, it } from 'vitest';

import { openNotebook } from '../notebookParse';

const ONE_PIXEL_PNG_BASE64 = 'iVBORwAAAAAAAAAASUhEUgAAAAEAAAAB';

function notebookBytes(notebook: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(notebook)).buffer as ArrayBuffer;
}

describe('openNotebook', () => {
  it('reads a markdown cell and a code cell with an image output', () => {
    const bytes = notebookBytes({
      nbformat: 4,
      metadata: {},
      cells: [
        { cell_type: 'markdown', source: 'hello' },
        {
          cell_type: 'code',
          source: 'print(1)',
          outputs: [{ data: { 'image/png': ONE_PIXEL_PNG_BASE64 } }],
        },
      ],
    });
    const result = openNotebook(bytes);
    expect(result.cells).toHaveLength(2);
    expect(result.cells[1]!.outputs).toHaveLength(1);
    expect(result.cells[1]!.outputs[0]!.kind).toBe('image');
    expect(result.cells[1]!.outputs[0]!.text.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('rejects a notebook that is not version 4', () => {
    const bytes = notebookBytes({ nbformat: 3, cells: [] });
    expect(() => openNotebook(bytes)).toThrow(
      'Preview supports version 4 notebooks with up to 500 cells.',
    );
  });
});
