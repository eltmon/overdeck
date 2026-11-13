/** PAN-5188 WI-13: pickViewer maps each tier-1 row of PRD §6.6 to its viewer. */
import { describe, expect, it } from 'vitest';

import { LARGE_TEXT_MAX_BYTES, pickViewer } from '../viewer-router';

const text = { kind: 'text', size: 10 } as const;
const binary = { kind: 'binary', size: 10 } as const;
const large = { kind: 'large-text', size: 10 * 1024 * 1024 } as const;

describe('pickViewer', () => {
  it.each([
    ['1 sqlite binary', 'data/app.sqlite3', binary, { kind: 'sqlite', delimiter: null, textEditable: false }],
    ['2 pdf', 'docs/a.pdf', binary, { kind: 'pdf', delimiter: null, textEditable: false }],
    ['3 image', 'img/a.PNG', binary, { kind: 'image', delimiter: null, textEditable: false }],
    ['4 svg text read', 'icon.svg', text, { kind: 'svg', delimiter: null, textEditable: true }],
    ['5 audio', 'song.flac', binary, { kind: 'audio', delimiter: null, textEditable: false }],
    ['6 font', 'f.woff2', binary, { kind: 'font', delimiter: null, textEditable: false }],
    ['7 archive', 'bundle.tgz', binary, { kind: 'archive', delimiter: null, textEditable: false }],
    ['8 csv text read', 'table.csv', text, { kind: 'table', delimiter: ',', textEditable: true }],
    ['8 tsv text read', 'table.tsv', text, { kind: 'table', delimiter: '\t', textEditable: true }],
    ['9 text read', 'src/a.ts', text, { kind: 'text', delimiter: null, textEditable: false }],
    ['10 large text over the cap', 'huge.log', { kind: 'large-text', size: LARGE_TEXT_MAX_BYTES + 1 }, { kind: 'binary', delimiter: null, textEditable: false }],
    ['11 large text', 'big.log', large, { kind: 'large-text', delimiter: null, textEditable: false }],
    ['11 large csv', 'big.csv', large, { kind: 'large-text', delimiter: ',', textEditable: false }],
    ['12 other binary', 'blob.xyz', binary, { kind: 'binary', delimiter: null, textEditable: false }],
    ['upper-case .CSV', 'T.CSV', text, { kind: 'table', delimiter: ',', textEditable: true }],
    ['a .db text read is text', 'notes.db', text, { kind: 'text', delimiter: null, textEditable: false }],
    ['an ASCII pdf text read is pdf', 'a.pdf', text, { kind: 'pdf', delimiter: null, textEditable: false }],
    ['an svg binary read is not editable', 'a.svg', binary, { kind: 'svg', delimiter: null, textEditable: false }],
  ] as const)('row %s', (_row, path, read, expected) => {
    expect(pickViewer(path, read)).toEqual(expected);
  });

  it('reads the extension from the basename only', () => {
    expect(pickViewer('archive.zip/readme', text).kind).toBe('text');
  });
});
