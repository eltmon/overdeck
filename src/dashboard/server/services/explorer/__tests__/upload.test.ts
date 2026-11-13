/** PAN-5188 WI-5: the upload sink streams to a temp file, caps bytes and commits without clobbering. */
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openUploadSink, validateUploadName } from '../upload.js';

let dir: string;

const temps = async () => (await readdir(dir)).filter((name) => name.startsWith('.overdeck-upload-'));

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'pan-5188-upload-')));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('openUploadSink', () => {
  it('writes chunks and commits the exact bytes', async () => {
    const sink = await openUploadSink(join(dir, 'x.bin'), 'x.bin');
    await sink.write(Buffer.from('hello, '));
    await sink.write(Buffer.from('upload'));
    const result = await sink.commit();
    expect(result).toMatchObject({ path: 'x.bin', size: 13 });
    expect(result.mtimeMs).toBeGreaterThan(0);
    expect(await readFile(join(dir, 'x.bin'), 'utf8')).toBe('hello, upload');
    expect(await temps()).toEqual([]);
  });

  it('throws FILE_TOO_LARGE past maxBytes and leaves no temp file after abort', async () => {
    const sink = await openUploadSink(join(dir, 'big.bin'), 'big.bin', 10);
    await sink.write(Buffer.alloc(6));
    await expect(sink.write(Buffer.alloc(5))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await sink.abort();
    expect(await temps()).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses to commit over a file that appeared while streaming', async () => {
    const sink = await openUploadSink(join(dir, 'race.txt'), 'race.txt');
    await sink.write(Buffer.from('mine'));
    await writeFile(join(dir, 'race.txt'), 'theirs');
    await expect(sink.commit()).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(await readFile(join(dir, 'race.txt'), 'utf8')).toBe('theirs');
    expect(await temps()).toEqual([]);
  });
});

describe('validateUploadName', () => {
  it.each(['', '.', '..', 'a/b', 'a\\b', 'a\0b', 'x'.repeat(256)])('refuses %j', (name) => {
    expect(validateUploadName(name)).toEqual(expect.any(String));
  });

  it('accepts a plain name and a 255-byte name', () => {
    expect(validateUploadName('photo.png')).toBeNull();
    expect(validateUploadName('x'.repeat(255))).toBeNull();
    expect(validateUploadName('é'.repeat(128))).toEqual(expect.any(String));
  });
});
