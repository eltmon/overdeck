import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { link, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

interface ProjectsConfigLockOwner {
  pid: number;
  startTime: string;
}

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

function processStartTimeFromStat(content: string): string | null {
  const closingParen = content.lastIndexOf(')');
  if (closingParen < 0) return null;
  return content.slice(closingParen + 2).trim().split(/\s+/)[19] ?? null;
}

function processStartTimeSync(pid: number): string | null {
  try {
    return processStartTimeFromStat(readFileSync(`/proc/${pid}/stat`, 'utf-8'));
  } catch {
    return null;
  }
}

async function processStartTime(pid: number): Promise<string | null> {
  try {
    return processStartTimeFromStat(await readFile(`/proc/${pid}/stat`, 'utf-8'));
  } catch {
    return null;
  }
}

function currentLockOwnerSync(): ProjectsConfigLockOwner {
  const startTime = processStartTimeSync(process.pid);
  if (!startTime) throw new Error('Could not resolve the projects-config writer process identity');
  return { pid: process.pid, startTime };
}

async function currentLockOwner(): Promise<ProjectsConfigLockOwner> {
  const startTime = await processStartTime(process.pid);
  if (!startTime) throw new Error('Could not resolve the projects-config writer process identity');
  return { pid: process.pid, startTime };
}

function parseLockOwner(content: string): ProjectsConfigLockOwner | null {
  try {
    const parsed = JSON.parse(content) as Partial<ProjectsConfigLockOwner>;
    return Number.isInteger(parsed.pid) && (parsed.pid ?? 0) > 0 && typeof parsed.startTime === 'string'
      ? { pid: parsed.pid!, startTime: parsed.startTime }
      : null;
  } catch {
    return null;
  }
}

function lockOwnerIsAliveSync(owner: ProjectsConfigLockOwner): boolean {
  const startTime = processStartTimeSync(owner.pid);
  return startTime !== null && startTime === owner.startTime;
}

async function lockOwnerIsAlive(owner: ProjectsConfigLockOwner): Promise<boolean> {
  const startTime = await processStartTime(owner.pid);
  return startTime !== null && startTime === owner.startTime;
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

function createProjectsConfigLockSync(lock: string, owner: ProjectsConfigLockOwner): number {
  const temporary = tempPath(`${lock}.owner`);
  let fd: number | null = null;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(owner)}\n`, 'utf-8');
    fsyncSync(fd);
    linkSync(temporary, lock);
    rmSync(temporary, { force: true });
    return fd;
  } catch (error) {
    if (fd !== null) closeSync(fd);
    rmSync(temporary, { force: true });
    throw error;
  }
}

async function createProjectsConfigLock(
  lock: string,
  owner: ProjectsConfigLockOwner,
): Promise<Awaited<ReturnType<typeof open>>> {
  const temporary = tempPath(`${lock}.owner`);
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(`${JSON.stringify(owner)}\n`, 'utf-8');
    await file.sync();
    await link(temporary, lock);
    await rm(temporary, { force: true });
    return file;
  } catch (error) {
    if (file !== null) await file.close();
    await rm(temporary, { force: true });
    throw error;
  }
}

function acquireProjectsConfigLockSync(path: string): number {
  const lock = lockPath(path);
  const owner = currentLockOwnerSync();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return createProjectsConfigLockSync(lock, owner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let existing: ProjectsConfigLockOwner | null;
      try {
        existing = parseLockOwner(readFileSync(lock, 'utf-8'));
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw readError;
      }
      if (!existing || lockOwnerIsAliveSync(existing)) {
        throw new Error(`projects.yaml is already being modified: ${path}`);
      }
      rmSync(lock, { force: true });
    }
  }
  throw new Error(`projects.yaml is already being modified: ${path}`);
}

async function acquireProjectsConfigLock(path: string): Promise<Awaited<ReturnType<typeof open>>> {
  const lock = lockPath(path);
  const owner = await currentLockOwner();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await createProjectsConfigLock(lock, owner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let existing: ProjectsConfigLockOwner | null;
      try {
        existing = parseLockOwner(await readFile(lock, 'utf-8'));
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw readError;
      }
      if (!existing || await lockOwnerIsAlive(existing)) {
        throw new Error(`projects.yaml is already being modified: ${path}`);
      }
      await rm(lock, { force: true });
    }
  }
  throw new Error(`projects.yaml is already being modified: ${path}`);
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
    try {
      closeSync(fd);
    } finally {
      rmSync(lockPath(path), { force: true });
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
  let file: Awaited<ReturnType<typeof open>> | null = null;
  let acquired = false;
  try {
    file = await acquireProjectsConfigLock(path);
    acquired = true;
    return await write();
  } finally {
    try {
      if (file !== null) await file.close();
    } finally {
      try {
        if (acquired) await rm(lockPath(path), { force: true });
      } finally {
        releaseQueue();
      }
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
