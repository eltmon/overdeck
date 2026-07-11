import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getOverdeckHome } from './paths.js';

export function stateMigrationLockPath(projectKey: string): string {
  return join(getOverdeckHome(), 'locks', 'state-migration', `${projectKey}.lock`);
}

export function isStateMigrationLocked(projectKey: string): boolean {
  try {
    const fd = openSync(stateMigrationLockPath(projectKey), 'wx');
    closeSync(fd);
    rmSync(stateMigrationLockPath(projectKey));
    return false;
  } catch {
    return true;
  }
}

export function acquireStateMigrationLock(projectKey: string): () => void {
  const path = stateMigrationLockPath(projectKey);
  mkdirSync(dirname(path), { recursive: true });
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch {
    throw new Error(`State migration already running for ${projectKey}: ${path}`);
  }
  return () => {
    closeSync(fd);
    rmSync(path, { force: true });
  };
}
