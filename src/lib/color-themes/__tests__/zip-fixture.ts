/**
 * Test-only ZIP writer for the .vsix import tests (PAN-4659). Builds archives
 * at test time so the refusal cases (ZIP64, encrypted, `..` names, lying sizes)
 * need no committed binaries. Deflates by default, can write data descriptors,
 * and always puts a comment after the EOCD, so the reader is exercised on the
 * shapes real packagers produce. Never imported by `src` code.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFixtureEntry {
  name: string;
  data: string | Buffer;
  method?: 0 | 8;            // default 8
  encrypted?: boolean;       // sets flag bit 0 (data left as-is)
  dataDescriptor?: boolean;  // flag bit 3; local header crc/sizes written as 0, a 16-byte descriptor follows the data
  declaredUncompressedSize?: number; // overrides the CD uncompressed size (to fake a lying header)
}

const DOS_DATE_1980_01_01 = 0x0021;

export function buildZip(entries: ZipFixtureEntry[], opts: { zip64?: boolean; comment?: string } = {}): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw) >>> 0;
    const name = Buffer.from(entry.name, 'utf8');
    const flags = 0x0800 | (entry.encrypted ? 0x0001 : 0) | (entry.dataDescriptor ? 0x0008 : 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    if (!entry.dataDescriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const parts = [local, name, body];
    if (entry.dataDescriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(body.length, 8);
      descriptor.writeUInt32LE(raw.length, 12);
      parts.push(descriptor);
    }
    const localBlock = Buffer.concat(parts);
    localParts.push(localBlock);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.declaredUncompressedSize ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += localBlock.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const comment = Buffer.from(opts.comment ?? 'fixture', 'utf8');
  const eocd = Buffer.alloc(22);
  const count = opts.zip64 ? 0xffff : entries.length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...localParts, centralDirectory, eocd, comment]);
}

/** A .vsix with [Content_Types].xml and extension.vsixmanifest at the root plus `files` (keys are archive paths). */
export function buildVsix(files: Record<string, string | Buffer>, opts: { zip64?: boolean } = {}): Buffer {
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/></Types>',
    },
    { name: 'extension.vsixmanifest', data: '<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0"/>' },
    ...Object.entries(files).map(([name, data]) => ({ name, data })),
  ], { zip64: opts.zip64 });
}
