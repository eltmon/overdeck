/** PAN-5188 WI-12: checkZipDirectory screens ZIP central directories before JSZip allocates them. */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { checkZipDirectory } from '../zipDirectory';

function endOfDirectory(entryCount: number): ArrayBuffer {
  const bytes = new ArrayBuffer(22);
  const view = new DataView(bytes);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  return bytes;
}

describe('checkZipDirectory', () => {
  it('accepts a small zip built with jszip', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'hello');
    zip.file('dir/b.txt', 'world');
    const bytes = await zip.generateAsync({ type: 'arraybuffer' });
    expect(() => checkZipDirectory(bytes)).not.toThrow();
  });

  it('rejects bytes without an end-of-central-directory record', () => {
    expect(() => checkZipDirectory(new TextEncoder().encode('not a zip at all, just text').buffer as ArrayBuffer)).toThrow(
      'not a readable ZIP archive',
    );
  });

  it('rejects a directory that declares more than 2,048 entries', () => {
    expect(() => checkZipDirectory(endOfDirectory(2049))).toThrow('more than 2,048 entries');
  });
});
