import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const realPanopticonHome = resolve(homedir(), '.panopticon');
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
  return resolved === realPanopticonHome || resolved.startsWith(`${realPanopticonHome}${sep}`)
    ? resolved
    : null;
}

function assertNotRealPanopticonHome(targets: unknown[]): void {
  for (const target of targets) {
    const blocked = blockedRealHomeTarget(target);
    if (blocked) {
      throw new Error(`[test-guard] write to REAL ~/.panopticon blocked: ${blocked} — set PANOPTICON_HOME to a temp dir`);
    }
  }
}

function allowRealPanopticonHomeWriteForTest(path: string): void {
  allowedRealHomeWrites.add(resolve(path));
}

(globalThis as typeof globalThis & {
  allowRealPanopticonHomeWriteForTest?: typeof allowRealPanopticonHomeWriteForTest;
}).allowRealPanopticonHomeWriteForTest = allowRealPanopticonHomeWriteForTest;

function guarded<T extends (...args: never[]) => unknown>(
  original: T,
  pathArgIndexes: number[],
): T {
  return function guardedFsWrite(this: unknown, ...args: unknown[]) {
    assertNotRealPanopticonHome(pathArgIndexes.map(index => args[index]));
    return Reflect.apply(original, this, args);
  } as T;
}

function guardedPromise<T extends (...args: never[]) => Promise<unknown>>(
  original: T,
  pathArgIndexes: number[],
): T {
  return function guardedPromiseFsWrite(this: unknown, ...args: unknown[]) {
    try {
      assertNotRealPanopticonHome(pathArgIndexes.map(index => args[index]));
    } catch (error) {
      return Promise.reject(error);
    }
    return Reflect.apply(original, this, args);
  } as T;
}

function withGuardedSyncFs(actual: Record<string, unknown>): Record<string, unknown> {
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
    createWriteStream: guarded(actual.createWriteStream as never, [0]),
    promises: withGuardedPromiseFs(actual.promises as Record<string, unknown>),
  };
}

function withGuardedPromiseFs(actual: Record<string, unknown>): Record<string, unknown> {
  return {
    ...actual,
    writeFile: guardedPromise(actual.writeFile as never, [0]),
    appendFile: guardedPromise(actual.appendFile as never, [0]),
    mkdir: guardedPromise(actual.mkdir as never, [0]),
    rm: guardedPromise(actual.rm as never, [0]),
    rename: guardedPromise(actual.rename as never, [0, 1]),
    cp: guardedPromise(actual.cp as never, [0, 1]),
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
    return withGuardedPromiseFs(actual);
  });
}
