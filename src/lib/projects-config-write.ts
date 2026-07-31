import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  fsyncSync,
} from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

let asyncWriteTail = Promise.resolve();
let tempSequence = 0;

function lockPath(path: string): string {
  return `${path}.lock`;
}

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
  const lock = lockPath(path);
  let fd: number;
  try {
    fd = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`projects.yaml is already being modified: ${path}`);
    }
    throw error;
  }
  try {
    return write();
  } finally {
    try {
      closeSync(fd);
    } finally {
      rmSync(lock, { force: true });
    }
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

  await mkdir(dirname(path), { recursive: true });
  const lock = lockPath(path);
  let file: Awaited<ReturnType<typeof open>> | null = null;
  let acquired = false;
  try {
    try {
      file = await open(lock, 'wx', 0o600);
      acquired = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`projects.yaml is already being modified: ${path}`);
      }
      throw error;
    }
    return await write();
  } finally {
    try {
      if (file !== null) await file.close();
    } finally {
      try {
        if (acquired) await rm(lock, { force: true });
      } finally {
        releaseQueue();
      }
    }
  }
}
