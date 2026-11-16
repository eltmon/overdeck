import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isComputerUseError } from '../errors.js';
import { elementRecord, saveScreenshot, saveSnapshot } from '../snapshot-store.js';

describe('snapshot-store (PAN-5452)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pan-computer-snapshot-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function deps() {
    return {
      snapshotDir: (holderKey: string) => join(root, 'snapshots', holderKey),
      screenshotDir: () => join(root, 'screenshots'),
    };
  }

  it('stores elements and returns the matching record by index (ac1)', async () => {
    await saveSnapshot(
      'holder-a',
      'gnome-calculator',
      { snapshotId: 's1', windowIndex: 0, elements: [{ index: 1, name: 'one' }, { index: 3, name: 'three' }] },
      deps(),
    );

    const record = await elementRecord('holder-a', 'gnome-calculator', 3, deps());
    expect(record).toEqual({ index: 3, name: 'three' });
  });

  it('throws element_not_found with a rerun hint when the index is missing (ac2)', async () => {
    await saveSnapshot(
      'holder-a',
      'gnome-calculator',
      { snapshotId: 's1', windowIndex: 0, elements: [{ index: 1, name: 'one' }] },
      deps(),
    );

    const error = await elementRecord('holder-a', 'gnome-calculator', 9, deps()).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('element_not_found');
    expect(error.message).toContain('Run pan computer get-app-state --app gnome-calculator');
  });

  it('keeps only the 50 newest PNGs after writing a 51st (ac3)', async () => {
    const d = deps();
    const dir = d.screenshotDir();
    await mkdir(dir, { recursive: true });
    const now = Date.now();
    for (let i = 0; i < 51; i++) {
      const path = join(dir, `old-${i}.png`);
      await writeFile(path, Buffer.from('x'));
      // All strictly in the past, oldest first, so the real new.png (written below) is newest.
      const mtime = new Date(now - (51 - i) * 1_000);
      await utimes(path, mtime, mtime);
    }

    const result = await saveScreenshot(
      { snapshotId: 'new', screenshotPngBase64: Buffer.from('png').toString('base64') },
      d,
    );
    expect(result?.path).toBe(join(dir, 'new.png'));

    const remaining = await readdir(dir);
    expect(remaining).toHaveLength(50);
    expect(remaining).toContain('new.png');
    expect(remaining).not.toContain('old-0.png');
  });

  it('decodes the base64 to a PNG file and returns no base64 field (ac4)', async () => {
    const d = deps();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = await saveScreenshot(
      { snapshotId: 'shot-1', screenshotPngBase64: png.toString('base64'), screenshotWidth: 100, screenshotHeight: 50, screenshotScale: 1 },
      d,
    );

    expect(result).toEqual({ path: join(d.screenshotDir(), 'shot-1.png'), width: 100, height: 50, scale: 1 });
    expect(result).not.toHaveProperty('screenshotPngBase64');
    const written = await readFile(result!.path);
    expect(written.equals(png)).toBe(true);
  });

  it('returns null when there is no screenshot', async () => {
    const result = await saveScreenshot({ snapshotId: 'no-shot' }, deps());
    expect(result).toBeNull();
  });
});
