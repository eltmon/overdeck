import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';

const INSTALL_ID_FILE = 'telemetry-id';

export function getOrCreateInstallId(): string {
  const overdeckHome = getOverdeckHome();
  const installIdPath = join(overdeckHome, INSTALL_ID_FILE);

  try {
    return readFileSync(installIdPath, 'utf8').trim();
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }

  mkdirSync(overdeckHome, { recursive: true });
  const installId = randomUUID();

  try {
    writeFileSync(installIdPath, `${installId}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return installId;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
    return readFileSync(installIdPath, 'utf8').trim();
  }
}
