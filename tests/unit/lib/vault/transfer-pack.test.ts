/** PAN-4650 WI-9: a transfer pack round-trips a directory and refuses entries that leave it. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { packDirectory, unpackDirectory } from '../../../../src/lib/vault/transfer-pack.js';

let root: string;

function entry(path: string, data: Buffer): Buffer {
  const name = Buffer.from(path, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(name.length);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  return Buffer.concat([header, name, size, data]);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pan-4650-pack-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('transfer pack (PAN-4650 WI-9)', () => {
  it('ac1: round-trips a nested directory byte for byte', async () => {
    const source = join(root, 'store');
    await mkdir(join(source, 'objects', 'ab'), { recursive: true });
    await mkdir(join(source, 'refs'), { recursive: true });
    const binary = Buffer.from([0, 255, 1, 254, 10, 13]);
    await writeFile(join(source, 'objects', 'ab', 'cdef'), binary);
    await writeFile(join(source, 'refs', 'record-é.json'), '{"v":1}');
    await writeFile(join(source, 'empty'), '');

    const pack = await packDirectory(source);
    const target = join(root, 'copy');
    expect(await unpackDirectory(pack, target)).toBe(3);

    expect(await readFile(join(target, 'objects', 'ab', 'cdef'))).toEqual(binary);
    expect(await readFile(join(target, 'refs', 'record-é.json'), 'utf8')).toBe('{"v":1}');
    expect(await readFile(join(target, 'empty'))).toEqual(Buffer.alloc(0));
  });

  it('ac1: refuses ../x and /abs entries without writing anything', async () => {
    const target = join(root, 'copy');
    for (const bad of ['../x', '/abs', 'a/../../x', 'a//b', './x']) {
      const pack = Buffer.concat([entry('ok.txt', Buffer.from('fine')), entry(bad, Buffer.from('evil'))]);
      await expect(unpackDirectory(pack, target)).rejects.toThrow(/transfer pack entry/);
    }
    await expect(readdir(target)).rejects.toThrow();
  });

  it('refuses a truncated pack', async () => {
    const pack = entry('a.txt', Buffer.from('hello')).subarray(0, 12);
    await expect(unpackDirectory(pack, join(root, 'copy'))).rejects.toThrow(/truncated/);
  });
});
