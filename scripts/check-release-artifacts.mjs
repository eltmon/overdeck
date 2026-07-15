#!/usr/bin/env node
/** Fail-closed verifier for electron-builder update metadata and payloads. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const MANIFESTS = {
  stable: ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'],
  canary: ['beta.yml', 'beta-mac.yml', 'beta-linux.yml'],
};

export async function verifyReleaseArtifacts(directory, version) {
  const channel = version.includes('-canary.') ? 'canary' : 'stable';
  const entries = new Set(await readdir(directory));
  const manifests = MANIFESTS[channel];
  const errors = [];

  for (const manifestName of manifests) {
    if (!entries.has(manifestName)) { errors.push(`missing manifest ${manifestName}`); continue; }
    const manifest = parse(await readFile(join(directory, manifestName), 'utf8'));
    if (manifest.version !== version) errors.push(`${manifestName} has version ${String(manifest.version)}, expected ${version}`);
    if (!Number.isInteger(manifest.overdeckDashboardProtocol) || !Number.isInteger(manifest.overdeckAgentProtocol)) errors.push(`${manifestName} is missing integer Overdeck protocol metadata`);
    const path = manifest.path ?? manifest.files?.[0]?.url;
    const sha512 = manifest.sha512 ?? manifest.files?.[0]?.sha512;
    if (!path || !entries.has(basename(path))) { errors.push(`${manifestName} names missing payload ${String(path)}`); continue; }
    if (!sha512) { errors.push(`${manifestName} is missing sha512`); continue; }
    const actual = createHash('sha512').update(await readFile(join(directory, basename(path)))).digest('base64');
    if (actual !== sha512) errors.push(`${manifestName} checksum does not match ${basename(path)}`);
    if (manifestName.includes('-mac') && !String(path).endsWith('.zip')) errors.push(`${manifestName} must name the macOS ZIP payload`);
  }
  if (![...entries].some((name) => name.endsWith('.dmg'))) errors.push('missing macOS DMG');
  if (![...entries].some((name) => name.endsWith('.zip'))) errors.push('missing macOS ZIP');
  if (![...entries].some((name) => name.endsWith('.exe'))) errors.push('missing Windows NSIS installer');
  if (![...entries].some((name) => name.endsWith('.AppImage'))) errors.push('missing Linux AppImage');
  if (errors.length) throw new Error(`Release artifact verification failed:\n- ${errors.join('\n- ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, version] = process.argv.slice(2);
  if (!directory || !version) throw new Error('Usage: check-release-artifacts.mjs <directory> <version>');
  await verifyReleaseArtifacts(resolve(directory), version);
  console.log(`Verified ${version} desktop update artifacts in ${directory}`);
}
