import { link, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

let tempSequence = 0

export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

export async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') throw error
  }
}

/**
 * Publish `value` at `path` atomically; throws EEXIST when `path` exists (PAN-4610).
 * Hard link rather than rename: a rename would replace an existing owner or
 * breaker file and break the exclusion every caller relies on (D13).
 */
export async function publishExclusive(path: string, value: unknown): Promise<void> {
  const temp = join(dirname(path), `.tmp-${process.pid}-${tempSequence++}-${basename(path)}`)
  const file = await open(temp, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
  } finally {
    await file.close()
  }
  try {
    await link(temp, path)
  } finally {
    await unlinkIfExists(temp)
  }
}

/** PAN-5285: overwrite our own ticket atomically (temp file, then rename). */
export async function replaceFile(path: string, value: unknown): Promise<void> {
  const temp = join(dirname(path), `.tmp-${process.pid}-${tempSequence++}-${basename(path)}`)
  try {
    const file = await open(temp, 'wx', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
    } finally {
      await file.close()
    }
    await rename(temp, path)
  } finally {
    await unlinkIfExists(temp)
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** Milliseconds since `path` was last modified, or null when it no longer exists. */
export async function fileAgeMs(path: string): Promise<number | null> {
  try {
    // Wall clock on purpose: mtime is wall-clock, and fake timers fake Date too.
    return Date.now() - (await stat(path)).mtimeMs
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null
    throw error
  }
}
