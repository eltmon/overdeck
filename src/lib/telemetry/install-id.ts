import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';

const INSTALL_ID_FILE = 'telemetry-id';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readValidInstallId(path: string): string | null {
  const installId = readFileSync(path, 'utf8').trim();
  return UUID_V4_PATTERN.test(installId) ? installId : null;
}

function replaceInvalidInstallId(path: string): string {
  const installId = randomUUID();
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${installId}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
    return installId;
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function getOrCreateInstallId(): string {
  const overdeckHome = getOverdeckHome();
  const installIdPath = join(overdeckHome, INSTALL_ID_FILE);

  try {
    const existing = readValidInstallId(installIdPath);
    return existing ?? replaceInvalidInstallId(installIdPath);
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
    const existing = readValidInstallId(installIdPath);
    return existing ?? replaceInvalidInstallId(installIdPath);
  }
}
