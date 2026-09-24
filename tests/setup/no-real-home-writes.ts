import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const realHome = homedir();
const realOverdeckHome = resolve(realHome, '.overdeck');
// Claude Code transcripts are irreplaceable conversation history (PAN-3915).
const realClaudeProjects = resolve(realHome, '.claude', 'projects');
const blockedRealHomeRoots = [realOverdeckHome, realClaudeProjects];
// Claude Code's own config: spawn paths pre-trust workspace dirs in it
// (PAN-3905), so a test that reaches one with the real HOME would otherwise add
// its temp paths to the operator's file.
const realClaudeJson = resolve(realHome, '.claude.json');
const allowedRealHomeWrites = new Set<string>();

function pathString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString();
  if (value instanceof URL) return fileURLToPath(value);
  return null;
}

function blockedRealHomeTarget(value: unknown): string | null {
  const rawPath = pathString(value);
  if (!rawPath) return null;
  const resolved = resolve(rawPath);
  if (allowedRealHomeWrites.has(resolved)) return null;
  if (resolved === realClaudeJson) return resolved;
  return blockedRealHomeRoots.some(root => resolved === root || resolved.startsWith(`${root}${sep}`))
    ? resolved
    : null;
}

function assertNotRealOverdeckHome(targets: unknown[]): void {
  for (const target of targets) {
    const blocked = blockedRealHomeTarget(target);
    if (blocked) {
      throw new Error(`[test-guard] write to REAL home blocked: ${blocked} — set OVERDECK_HOME/HOME to a temp dir or inject the root`);
    }
  }
}

function allowRealOverdeckHomeWriteForTest(path: string): void {
  allowedRealHomeWrites.add(resolve(path));
}

(globalThis as typeof globalThis & {
  allowRealOverdeckHomeWriteForTest?: typeof allowRealOverdeckHomeWriteForTest;
}).allowRealOverdeckHomeWriteForTest = allowRealOverdeckHomeWriteForTest;

function guarded<T extends (...args: never[]) => unknown>(
  original: T,
  pathArgIndexes: number[],
): T {
  return function guardedFsWrite(this: unknown, ...args: unknown[]) {
    assertNotRealOverdeckHome(pathArgIndexes.map(index => args[index]));
    return Reflect.apply(original, this, args);
  } as T;
}

function guardedPromise<T extends (...args: never[]) => Promise<unknown>>(
  original: T,
  pathArgIndexes: number[],
): T {
  return function guardedPromiseFsWrite(this: unknown, ...args: unknown[]) {
    try {
      assertNotRealOverdeckHome(pathArgIndexes.map(index => args[index]));
    } catch (error) {
      return Promise.reject(error);
    }
    return Reflect.apply(original, this, args);
  } as T;
}

const OPEN_WRITE_BITS = ['O_WRONLY', 'O_RDWR', 'O_CREAT', 'O_APPEND', 'O_TRUNC'];

// open/openSync only write when the flags ask for it; a read-only open of a
// real transcript stays allowed.
function isWriteOpenFlag(flags: unknown, constants: Record<string, number> | undefined): boolean {
  if (typeof flags === 'string') return /[wa+]/.test(flags);
  if (typeof flags === 'number') {
    const writeMask = OPEN_WRITE_BITS.reduce((mask, name) => mask | (constants?.[name] ?? 0), 0);
    return (flags & writeMask) !== 0;
  }
  return false;
}

function guardedOpen<T extends (...args: never[]) => unknown>(
  original: T,
  constants: Record<string, number> | undefined,
): T {
  return function guardedFsOpen(this: unknown, ...args: unknown[]) {
    if (isWriteOpenFlag(args[1], constants)) assertNotRealOverdeckHome([args[0]]);
    return Reflect.apply(original, this, args);
  } as T;
}

function guardedPromiseOpen<T extends (...args: never[]) => Promise<unknown>>(
  original: T,
  constants: Record<string, number> | undefined,
): T {
  return function guardedPromiseFsOpen(this: unknown, ...args: unknown[]) {
    try {
      if (isWriteOpenFlag(args[1], constants)) assertNotRealOverdeckHome([args[0]]);
    } catch (error) {
      return Promise.reject(error);
    }
    return Reflect.apply(original, this, args);
  } as T;
}

function withGuardedSyncFs(actual: Record<string, unknown>): Record<string, unknown> {
  const constants = actual.constants as Record<string, number> | undefined;
  return {
    ...actual,
    writeFileSync: guarded(actual.writeFileSync as never, [0]),
    appendFileSync: guarded(actual.appendFileSync as never, [0]),
    mkdirSync: guarded(actual.mkdirSync as never, [0]),
    rmSync: guarded(actual.rmSync as never, [0]),
    rmdirSync: guarded(actual.rmdirSync as never, [0]),
    unlinkSync: guarded(actual.unlinkSync as never, [0]),
    renameSync: guarded(actual.renameSync as never, [0, 1]),
    cpSync: guarded(actual.cpSync as never, [0, 1]),
    cp: guarded(actual.cp as never, [0, 1]),
    copyFileSync: guarded(actual.copyFileSync as never, [1]),
    copyFile: guarded(actual.copyFile as never, [1]),
    symlinkSync: guarded(actual.symlinkSync as never, [1]),
    symlink: guarded(actual.symlink as never, [1]),
    truncateSync: guarded(actual.truncateSync as never, [0]),
    truncate: guarded(actual.truncate as never, [0]),
    openSync: guardedOpen(actual.openSync as never, constants),
    open: guardedOpen(actual.open as never, constants),
    createWriteStream: guarded(actual.createWriteStream as never, [0]),
    promises: withGuardedPromiseFs(actual.promises as Record<string, unknown>, constants),
  };
}

function withGuardedPromiseFs(
  actual: Record<string, unknown>,
  constants: Record<string, number> | undefined,
): Record<string, unknown> {
  return {
    ...actual,
    writeFile: guardedPromise(actual.writeFile as never, [0]),
    appendFile: guardedPromise(actual.appendFile as never, [0]),
    mkdir: guardedPromise(actual.mkdir as never, [0]),
    rm: guardedPromise(actual.rm as never, [0]),
    rmdir: guardedPromise(actual.rmdir as never, [0]),
    unlink: guardedPromise(actual.unlink as never, [0]),
    rename: guardedPromise(actual.rename as never, [0, 1]),
    cp: guardedPromise(actual.cp as never, [0, 1]),
    copyFile: guardedPromise(actual.copyFile as never, [1]),
    symlink: guardedPromise(actual.symlink as never, [1]),
    truncate: guardedPromise(actual.truncate as never, [0]),
    open: guardedPromiseOpen(actual.open as never, constants),
  };
}

for (const moduleId of ['fs', 'node:fs']) {
  vi.doMock(moduleId, async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return withGuardedSyncFs(actual);
  });
}

for (const moduleId of ['fs/promises', 'node:fs/promises']) {
  vi.doMock(moduleId, async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return withGuardedPromiseFs(actual, actual.constants as Record<string, number> | undefined);
  });
}
