/**
 * Pack a directory into one buffer and back (PAN-4650 D-4650-9).
 *
 * A Pull here transfer settles a conversation into a fresh `dir:` vault store
 * on the owner, packs that store directory, sends it through the secure
 * channel, and unpacks it on the viewer. The format is a repeated
 * `uint32be pathLength, path (UTF-8, relative, '/'-separated), uint32be
 * dataLength, data`. Unpacking refuses absolute paths and any `..` segment.
 * Node built-ins only, so `pan vault` stays standalone.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

async function listFiles(root: string, dir = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** Every regular file under `dir`, in sorted path order. */
export async function packDirectory(dir: string): Promise<Buffer> {
  const files = (await listFiles(dir)).sort();
  const parts: Buffer[] = [];
  for (const file of files) {
    const path = Buffer.from(relative(dir, file).split(sep).join('/'), 'utf8');
    const data = await readFile(file);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(path.length);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    parts.push(header, path, size, data);
  }
  return Buffer.concat(parts);
}

/** The relative path of one entry, or an error naming why it is refused. */
function safeEntryPath(path: string): string {
  if (path === '' || isAbsolute(path) || path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    throw new Error(`transfer pack entry ${JSON.stringify(path)} is not a relative path`);
  }
  if (path.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')) {
    throw new Error(`transfer pack entry ${JSON.stringify(path)} leaves the target directory`);
  }
  return path;
}

/** Write a packed buffer's files under `dir`. Every entry is checked before any file is written. */
export async function unpackDirectory(pack: Buffer, dir: string): Promise<number> {
  const entries: Array<{ path: string; data: Buffer }> = [];
  let offset = 0;
  const read = (length: number): Buffer => {
    if (offset + length > pack.length) throw new Error('transfer pack is truncated');
    const slice = pack.subarray(offset, offset + length);
    offset += length;
    return slice;
  };
  while (offset < pack.length) {
    const path = safeEntryPath(read(read(4).readUInt32BE()).toString('utf8'));
    entries.push({ path, data: read(read(4).readUInt32BE()) });
  }
  for (const { path, data } of entries) {
    const target = join(dir, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return entries.length;
}
