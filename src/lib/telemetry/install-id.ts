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
const INSTALL_ID_REPAIR_LOCK = 'telemetry-id.repair.lock';
const REPAIR_WAIT_MS = 10;
const REPAIR_MAX_ATTEMPTS = 200;
const REPAIR_WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readValidInstallId(path: string): string | null {
  const installId = readFileSync(path, 'utf8').trim();
  return UUID_V4_PATTERN.test(installId) ? installId : null;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error
    ? String(error.code)
    : undefined;
}

function repairOwnerIsAlive(lockPath: string): boolean {
  try {
    const ownerPid = Number(readFileSync(lockPath, 'utf8').trim());
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) return false;
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

function replaceInvalidInstallId(path: string): void {
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
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function repairInvalidInstallId(path: string, overdeckHome: string): string {
  const lockPath = join(overdeckHome, INSTALL_ID_REPAIR_LOCK);
  for (let attempt = 0; attempt < REPAIR_MAX_ATTEMPTS; attempt += 1) {
    try {
      writeFileSync(lockPath, `${process.pid}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      const winner = readValidInstallId(path);
      if (winner) return winner;
      if (!repairOwnerIsAlive(lockPath)) {
        rmSync(lockPath, { force: true });
        continue;
      }
      Atomics.wait(REPAIR_WAIT_ARRAY, 0, 0, REPAIR_WAIT_MS);
      continue;
    }

    try {
      const winner = readValidInstallId(path);
      if (winner) return winner;
      replaceInvalidInstallId(path);
      const repaired = readValidInstallId(path);
      if (!repaired) throw new Error(`Failed to repair ${path}`);
      return repaired;
    } finally {
      rmSync(lockPath, { force: true });
    }
  }
  throw new Error(`Timed out waiting to repair ${path}`);
}

export function getOrCreateInstallId(): string {
  const overdeckHome = getOverdeckHome();
  const installIdPath = join(overdeckHome, INSTALL_ID_FILE);

  try {
    const existing = readValidInstallId(installIdPath);
    return existing ?? repairInvalidInstallId(installIdPath, overdeckHome);
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
    return existing ?? repairInvalidInstallId(installIdPath, overdeckHome);
  }
}
