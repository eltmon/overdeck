import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const contractsSource = await readFile(new URL('../../../packages/contracts/src/update.ts', import.meta.url), 'utf8');
const dashboardProtocol = contractsSource.match(/OVERDECK_DASHBOARD_PROTOCOL_VERSION = (\d+)/)?.[1];
const agentProtocol = contractsSource.match(/OVERDECK_AGENT_PROTOCOL_VERSION = (\d+)/)?.[1];
if (!dashboardProtocol || !agentProtocol) throw new Error('Unable to read updater protocol constants from @overdeck/contracts');

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
  await writeFile(path, `${withoutOldStamp.trimEnd()}\noverdeckDashboardProtocol: ${dashboardProtocol}\noverdeckAgentProtocol: ${agentProtocol}\n`);
}

console.log(`Stamped ${manifests.join(', ')} with Overdeck runtime protocols.`);
