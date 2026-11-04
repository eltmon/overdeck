import { describe, expect, it } from 'vitest';
import { readZipDirectory, readZipEntry, ZipFormatError, type ZipEntry } from '../zip-reader.js';
import { buildZip } from './zip-fixture.js';

const MiB = 1024 * 1024;

function entryOf(archive: Buffer, name: string): ZipEntry {
  const entry = readZipDirectory(archive).get(name);
  if (!entry) throw new Error(`fixture is missing ${name}`);
  return entry;
}

function directoryError(archive: Buffer): ZipFormatError {
  try {
    readZipDirectory(archive);
  } catch (err) {
    expect(err).toBeInstanceOf(ZipFormatError);
    return err as ZipFormatError;
  }
  throw new Error('readZipDirectory did not throw');
}

describe('readZipEntry', () => {
  it('reads stored, deflated and data-descriptor entries back byte-for-byte', async () => {
    const stored = Buffer.from('stored bytes \u00e9');
    const deflated = Buffer.from('deflated '.repeat(500));
    const described = Buffer.from(JSON.stringify({ name: 'described', colors: { a: '#ffffff' } }));
    const archive = buildZip([
      { name: 'extension/stored.txt', data: stored, method: 0 },
      { name: 'extension/deflated.txt', data: deflated },
      { name: 'extension/described.json', data: described, dataDescriptor: true },
    ]);

    expect(entryOf(archive, 'extension/stored.txt').method).toBe(0);
    expect(entryOf(archive, 'extension/deflated.txt').method).toBe(8);
    expect(await readZipEntry(archive, entryOf(archive, 'extension/stored.txt'), MiB)).toEqual(stored);
    expect(await readZipEntry(archive, entryOf(archive, 'extension/deflated.txt'), MiB)).toEqual(deflated);
    expect(await readZipEntry(archive, entryOf(archive, 'extension/described.json'), MiB)).toEqual(described);
  });

  it('rejects an entry over maxBytes when its size is declared honestly', async () => {
    const archive = buildZip([{ name: 'big.json', data: Buffer.alloc(3 * MiB, 'a') }]);

    await expect(readZipEntry(archive, entryOf(archive, 'big.json'), 2 * MiB)).rejects.toThrow(ZipFormatError);
  });

  it('rejects an entry whose central directory lies about its size without returning more than maxBytes', async () => {
    const archive = buildZip([{ name: 'liar.json', data: Buffer.alloc(3 * MiB, 'a'), declaredUncompressedSize: 100 }]);
    const entry = entryOf(archive, 'liar.json');
    expect(entry.uncompressedSize).toBe(100);

    let result: Buffer | undefined;
    let error: unknown;
    try {
      result = await readZipEntry(archive, entry, 2 * MiB);
    } catch (err) {
      error = err;
    }
    expect(result).toBeUndefined();
    expect(error).toBeInstanceOf(ZipFormatError);
  });

  it('rejects an unsupported compression method', async () => {
    const archive = buildZip([{ name: 'x.json', data: '{}', method: 0 }]);
    const entry = { ...entryOf(archive, 'x.json'), method: 12 };

    await expect(readZipEntry(archive, entry, MiB)).rejects.toThrow(/unsupported compression method 12/);
  });

  it('rejects a stored entry with one flipped data byte', async () => {
    const archive = buildZip([{ name: 'x.json', data: '{"name":"flip"}', method: 0 }]);
    const entry = entryOf(archive, 'x.json');
    const dataStart = entry.localHeaderOffset + 30 + archive.readUInt16LE(entry.localHeaderOffset + 26);
    archive[dataStart + 3] ^= 0xff;

    await expect(readZipEntry(archive, entry, MiB)).rejects.toThrow(/corrupt/);
  });

  it('rejects a deflated entry with one flipped data byte', async () => {
    const archive = buildZip([{ name: 'x.json', data: JSON.stringify({ name: 'flip', colors: { a: '#000000' } }) }]);
    const entry = entryOf(archive, 'x.json');
    const dataStart = entry.localHeaderOffset + 30 + archive.readUInt16LE(entry.localHeaderOffset + 26);
    archive[dataStart + 2] ^= 0xff;

    await expect(readZipEntry(archive, entry, MiB)).rejects.toThrow(/corrupt/);
  });
});

describe('readZipDirectory', () => {
  it('lists file entries and leaves directory entries out', () => {
    const archive = buildZip([
      { name: 'extension/', data: '', method: 0 },
      { name: 'extension/package.json', data: '{}' },
    ]);

    expect([...readZipDirectory(archive).keys()]).toEqual(['extension/package.json']);
  });

  it('finds the end of central directory past an archive comment', () => {
    const archive = buildZip([{ name: 'a.json', data: '{}' }], { comment: 'x'.repeat(1000) });

    expect(readZipDirectory(archive).has('a.json')).toBe(true);
  });

  it('rejects a buffer that is not a ZIP archive', () => {
    expect(directoryError(Buffer.from('{"name":"not a zip"}')).message).toMatch(/end of central directory/);
    expect(directoryError(Buffer.alloc(0)).message).toMatch(/end of central directory/);
  });

  it('rejects ZIP64 archives', () => {
    const archive = buildZip([{ name: 'a.json', data: '{}' }], { zip64: true });

    expect(directoryError(archive).message).toMatch(/ZIP64/);
  });

  it('rejects encrypted entries', () => {
    const archive = buildZip([{ name: 'a.json', data: '{}' }, { name: 'secret.json', data: '{}', encrypted: true }]);

    expect(directoryError(archive).message).toMatch(/encrypted/);
  });

  it('rejects WinZip AES entries (method 99)', () => {
    const archive = buildZip([{ name: 'aes.json', data: '{}', method: 0 }]);
    const cd = archive.readUInt32LE(archive.length - 'fixture'.length - 22 + 16);
    archive.writeUInt16LE(99, cd + 10);

    expect(directoryError(archive).message).toMatch(/encrypted/);
  });

  it.each(['../evil.json', 'extension/../../evil.json', '/abs.json', 'C:/x.json', 'extension\\x.json', 'a\0b.json'])(
    'rejects the unsafe entry path %j',
    (name) => {
      const archive = buildZip([{ name: 'extension/package.json', data: '{}' }, { name, data: '{}' }]);

      expect(directoryError(archive).message).toMatch(/unsafe entry path/);
    },
  );

  it('rejects duplicate entry names', () => {
    const archive = buildZip([{ name: 'a.json', data: '{}' }, { name: 'a.json', data: '{"b":1}' }]);

    expect(directoryError(archive).message).toMatch(/duplicate entry/);
  });
});
