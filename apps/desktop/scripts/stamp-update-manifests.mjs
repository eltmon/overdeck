import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = new URL('../dist/', import.meta.url);
const entries = await readdir(distDir);
const manifests = entries.filter((name) => /^(latest|beta)(-(mac|linux))?\.yml$/.test(name));

if (manifests.length === 0) {
  throw new Error('electron-builder produced no update manifest');
}

for (const name of manifests) {
  const path = join(distDir.pathname, name);
  const source = await readFile(path, 'utf8');
  const withoutOldStamp = source
    .replace(/^overdeckDashboardProtocol:.*\n?/m, '')
    .replace(/^overdeckAgentProtocol:.*\n?/m, '');
  await writeFile(path, `${withoutOldStamp.trimEnd()}\noverdeckDashboardProtocol: 1\noverdeckAgentProtocol: 1\n`);
}

console.log(`Stamped ${manifests.join(', ')} with Overdeck runtime protocols.`);
