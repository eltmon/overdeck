import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { verifyReleaseArtifacts } from '../../../scripts/check-release-artifacts.mjs';

async function fixture(version = '1.2.3') {
  const dir = await mkdtemp(join(tmpdir(), 'overdeck-updates-'));
  const prefix = version.includes('canary') ? 'beta' : 'latest';
  const payloads = [['Overdeck.exe', 'win'], ['Overdeck.zip', 'mac'], ['Overdeck.AppImage', 'linux']] as const;
  await writeFile(join(dir, 'Overdeck.dmg'), 'dmg');
  for (const [name, content] of payloads) await writeFile(join(dir, name), content);
  for (const [suffix, payload] of [['', 'Overdeck.exe'], ['-mac', 'Overdeck.zip'], ['-linux', 'Overdeck.AppImage']] as const) {
    const data = await import('node:fs/promises').then(({ readFile }) => readFile(join(dir, payload)));
    await writeFile(join(dir, `${prefix}${suffix}.yml`), stringify({ version, path: payload, sha512: createHash('sha512').update(data).digest('base64'), overdeckDashboardProtocol: 1, overdeckAgentProtocol: 1 }));
  }
  return dir;
}

describe('release artifact verifier', () => {
  it.each(['1.2.3', '1.2.4-canary.1'])('accepts a complete %s release', async (version) => expect(verifyReleaseArtifacts(await fixture(version), version)).resolves.toBeUndefined());
  it('rejects a wrong checksum', async () => {
    const dir = await fixture(); await writeFile(join(dir, 'Overdeck.exe'), 'changed');
    await expect(verifyReleaseArtifacts(dir, '1.2.3')).rejects.toThrow('checksum does not match');
  });
  it('rejects missing manifests', async () => expect(verifyReleaseArtifacts(await mkdtemp(join(tmpdir(), 'overdeck-empty-')), '1.2.3')).rejects.toThrow('missing manifest'));
});
