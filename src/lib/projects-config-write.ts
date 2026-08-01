import { spawn, spawnSync } from 'node:child_process';
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

interface ProjectsConfigUpdate<T> {
  content: string;
  result: T;
}

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

function acquireProjectsConfigLockSync(path: string): number {
  const lock = lockPath(path);
  const fd = openSync(lock, 'a+', 0o600);
  const result = spawnSync('flock', ['-n', '3'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'ignore', 'pipe', fd],
  });
  if (result.status === 0) return fd;
  closeSync(fd);
  if (result.error) throw result.error;
  throw new Error(`projects.yaml is already being modified: ${path}`);
}

function acquireProjectsConfigLock(path: string): Promise<Awaited<ReturnType<typeof open>>> {
  return open(lockPath(path), 'a+', 0o600).then(file => new Promise((resolve, reject) => {
    const child = spawn('flock', ['-n', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', file.fd],
    });
    let stderr = '';
    let settled = false;
    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      void file.close().finally(() => reject(error));
    });
    child.once('exit', code => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(file);
        return;
      }
      void file.close().finally(() => reject(new Error(
        stderr.trim() || `projects.yaml is already being modified: ${path}`,
      )));
    });
  }));
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
  const fd = acquireProjectsConfigLockSync(path);
  try {
    return write();
  } finally {
    closeSync(fd);
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

  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await mkdir(dirname(path), { recursive: true });
    file = await acquireProjectsConfigLock(path);
    return await write();
  } finally {
    try {
      if (file !== null) await file.close();
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
