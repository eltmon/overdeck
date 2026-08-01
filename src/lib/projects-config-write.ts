import {
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  acquireProjectsConfigLock,
  acquireProjectsConfigLockSync,
} from './projects-config-lock.js';

interface ProjectsConfigUpdate<T> {
  content: string;
  result: T;
}

let asyncWriteTail = Promise.resolve();
let tempSequence = 0;

function tempPath(path: string): string {
  tempSequence += 1;
  return `${path}.${process.pid}.${tempSequence}.tmp`;
}

function existingModeSync(path: string): number {
  try {
    return statSync(path).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0o600;
    throw error;
  }
}

async function existingMode(path: string): Promise<number> {
  try {
    return (await stat(path)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0o600;
    throw error;
  }
}

export function atomicWriteProjectsConfigSync(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = tempPath(path);
  let fd: number | null = null;
  try {
    fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, existingModeSync(path));
    writeFileSync(fd, content, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporary, path);
    const dirFd = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } finally {
    try {
      if (fd !== null) closeSync(fd);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

export async function atomicWriteProjectsConfig(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = tempPath(path);
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, await existingMode(path));
    await file.writeFile(content, 'utf-8');
    await file.sync();
    await file.close();
    file = null;
    await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    try {
      if (file !== null) await file.close();
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export function withProjectsConfigWriteSync<T>(path: string, write: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lock = acquireProjectsConfigLockSync(path);
  try {
    return write();
  } finally {
    lock.release();
  }
}

export async function withProjectsConfigWrite<T>(path: string, write: () => Promise<T>): Promise<T> {
  const previous = asyncWriteTail;
  let releaseQueue!: () => void;
  const current = new Promise<void>(resolve => {
    releaseQueue = resolve;
  });
  asyncWriteTail = previous.catch(() => undefined).then(() => current);
  await previous.catch(() => undefined);

  let lock: Awaited<ReturnType<typeof acquireProjectsConfigLock>> | null = null;
  try {
    await mkdir(dirname(path), { recursive: true });
    lock = await acquireProjectsConfigLock(path);
    return await write();
  } finally {
    try {
      if (lock !== null) await lock.release();
    } finally {
      releaseQueue();
    }
  }
}

export function updateProjectsConfigTextSync<T>(
  path: string,
  fallback: string,
  transform: (content: string) => ProjectsConfigUpdate<T>,
): T {
  return withProjectsConfigWriteSync(path, () => {
    let content: string;
    try {
      content = readFileSync(path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      content = fallback;
    }
    const updated = transform(content);
    if (updated.content !== content) atomicWriteProjectsConfigSync(path, updated.content);
    return updated.result;
  });
}

export async function updateProjectsConfigText<T>(
  path: string,
  fallback: string,
  transform: (content: string) => ProjectsConfigUpdate<T> | Promise<ProjectsConfigUpdate<T>>,
): Promise<T> {
  return withProjectsConfigWrite(path, async () => {
    const content = await readFile(path, 'utf-8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw error;
    });
    const updated = await transform(content);
    if (updated.content !== content) await atomicWriteProjectsConfig(path, updated.content);
    return updated.result;
  });
}
