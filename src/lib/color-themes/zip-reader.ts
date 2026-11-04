/**
 * Minimal read-only ZIP reader for .vsix import (PAN-4659): stored + deflated
 * entries only. Sizes always come from the central directory, never the local
 * header, and every refusal (ZIP64, multi-disk, encryption, unsafe or
 * duplicate names) is checked over the whole directory up front. Inflate is
 * async and capped by `maxOutputLength`, so a lying size header cannot make
 * it allocate past the caller's limit.
 */
import { crc32, inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const inflateRawAsync = promisify(inflateRaw);

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CD_SIGNATURE = 0x02014b50;
const CD_FIXED_SIZE = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_FIXED_SIZE = 30;
const ZIP64_EXTRA_ID = 0x0001;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const METHOD_AES = 99;

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
}

const ZIP64_MESSAGE = 'ZIP64 archives are not supported';

function findEocd(archive: Buffer): number {
  const lowest = Math.max(0, archive.length - EOCD_SIZE - 0xffff);
  for (let i = archive.length - EOCD_SIZE; i >= lowest; i -= 1) {
    if (archive.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new ZipFormatError('not a ZIP archive (end of central directory not found)');
}

function hasZip64Extra(archive: Buffer, start: number, end: number): boolean {
  for (let p = start; p + 4 <= end; ) {
    if (archive.readUInt16LE(p) === ZIP64_EXTRA_ID) return true;
    p += 4 + archive.readUInt16LE(p + 2);
  }
  return false;
}

function isUnsafeName(name: string): boolean {
  return name.startsWith('/')
    || /^[A-Za-z]:/.test(name)
    || name.includes('\\')
    || name.includes('\0')
    || name.split('/').includes('..');
}

/** Parses and validates the whole central directory. Throws ZipFormatError on any refusal. Directory entries (names ending in '/') are validated but left out of the map. */
export function readZipDirectory(archive: Buffer): Map<string, ZipEntry> {
  const eocd = findEocd(archive);
  const diskNumber = archive.readUInt16LE(eocd + 4);
  const cdDiskNumber = archive.readUInt16LE(eocd + 6);
  const diskEntries = archive.readUInt16LE(eocd + 8);
  const totalEntries = archive.readUInt16LE(eocd + 10);
  const cdSize = archive.readUInt32LE(eocd + 12);
  const cdOffset = archive.readUInt32LE(eocd + 16);

  if (
    diskEntries === 0xffff || totalEntries === 0xffff
    || cdSize === 0xffffffff || cdOffset === 0xffffffff
    || (eocd >= 20 && archive.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIGNATURE)
  ) {
    throw new ZipFormatError(ZIP64_MESSAGE);
  }
  if (diskNumber !== 0 || cdDiskNumber !== 0 || diskEntries !== totalEntries) {
    throw new ZipFormatError('multi-disk archives are not supported');
  }
  const cdEnd = cdOffset + cdSize;
  if (cdEnd > eocd) {
    throw new ZipFormatError('central directory is out of bounds');
  }

  const entries = new Map<string, ZipEntry>();
  const seen = new Set<string>();
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (p + CD_FIXED_SIZE > cdEnd || archive.readUInt32LE(p) !== CD_SIGNATURE) {
      throw new ZipFormatError('corrupt central directory');
    }
    const flags = archive.readUInt16LE(p + 8);
    const method = archive.readUInt16LE(p + 10);
    const crc = archive.readUInt32LE(p + 16);
    const compressedSize = archive.readUInt32LE(p + 20);
    const uncompressedSize = archive.readUInt32LE(p + 24);
    const nameLength = archive.readUInt16LE(p + 28);
    const extraLength = archive.readUInt16LE(p + 30);
    const commentLength = archive.readUInt16LE(p + 32);
    const localHeaderOffset = archive.readUInt32LE(p + 42);
    const nameStart = p + CD_FIXED_SIZE;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > cdEnd) {
      throw new ZipFormatError('corrupt central directory');
    }
    const name = archive.toString((flags & FLAG_UTF8) !== 0 ? 'utf8' : 'latin1', nameStart, extraStart);

    if (
      compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff
      || hasZip64Extra(archive, extraStart, extraStart + extraLength)
    ) {
      throw new ZipFormatError(ZIP64_MESSAGE);
    }
    if ((flags & FLAG_ENCRYPTED) !== 0 || method === METHOD_AES) {
      throw new ZipFormatError(`encrypted entries are not supported ("${name}")`);
    }
    if (isUnsafeName(name)) {
      throw new ZipFormatError(`unsafe entry path "${name}" (absolute, backslash, NUL or ".." segment)`);
    }
    if (seen.has(name)) {
      throw new ZipFormatError(`duplicate entry "${name}"`);
    }
    seen.add(name);
    if (!name.endsWith('/')) {
      entries.set(name, { name, method, compressedSize, uncompressedSize, crc32: crc, localHeaderOffset });
    }
    p = next;
  }
  return entries;
}

/** Reads one entry's bytes. Throws ZipFormatError when uncompressedSize > maxBytes, the method is not 0 or 8, the local header is bad, inflate fails or exceeds maxBytes, or the length/CRC-32 does not match. */
export async function readZipEntry(archive: Buffer, entry: ZipEntry, maxBytes: number): Promise<Buffer> {
  const { name } = entry;
  if (entry.uncompressedSize > maxBytes) {
    throw new ZipFormatError(`entry "${name}" is ${entry.uncompressedSize} bytes; the limit is ${maxBytes}`);
  }
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATED) {
    throw new ZipFormatError(`entry "${name}" uses unsupported compression method ${entry.method}`);
  }
  const offset = entry.localHeaderOffset;
  if (offset + LOCAL_FIXED_SIZE > archive.length || archive.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new ZipFormatError(`entry "${name}" has a bad local header`);
  }
  const start = offset + LOCAL_FIXED_SIZE + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
  const end = start + entry.compressedSize;
  if (end > archive.length) {
    throw new ZipFormatError(`entry "${name}" data runs past the end of the archive`);
  }
  const data = archive.subarray(start, end);

  let out: Buffer;
  if (entry.method === METHOD_STORED) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new ZipFormatError(`entry "${name}" is corrupt (size or CRC mismatch)`);
    }
    out = data;
  } else {
    try {
      out = await inflateRawAsync(data, { maxOutputLength: maxBytes });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
        throw new ZipFormatError(`entry "${name}" inflates past the limit of ${maxBytes} bytes`);
      }
      throw new ZipFormatError(`entry "${name}" is corrupt (${(err as Error).message})`);
    }
  }
  if (out.length !== entry.uncompressedSize || (crc32(out) >>> 0) !== entry.crc32) {
    throw new ZipFormatError(`entry "${name}" is corrupt (size or CRC mismatch)`);
  }
  return out;
}
