// Directory loading for the explorer tree (PAN-5186, WI-B6).
//
// createDirectoryLoader runs explorerListDir calls with a concurrency cap of 4
// (the behavior of t3code's useDirectoryEntries; no code is ported). ensure()
// loads a directory once; reload() re-lists it, and a directory that is in
// flight is listed once more after it settles, so a watch event that lands
// during a listing is never lost. expandAll() walks breadth-first for the
// header's Expand all button, capped at 2,000 folders (D-B12).

import type { ExplorerEntry, ExplorerListDirResult } from '@overdeck/contracts'

import { explorerErrorCode, explorerErrorMessage } from '../explorer-rpc'

export interface DirectoryLoaderDeps {
  rootId: string
  listDir(rootId: string, path: string): Promise<ExplorerListDirResult>
  onLoading(path: string): void
  onResult(path: string, result: ExplorerListDirResult): void
  onError(path: string, code: string | undefined, message: string): void
  maxConcurrent?: number
}

export interface DirectoryLoader {
  /** Load `path` unless it is loaded or in flight. */
  ensure(path: string): void
  /** Re-list each path; a path in flight runs once more after it settles. */
  reload(paths: Iterable<string>): void
  /** Forget that `path` was loaded, so the next ensure() lists it again. */
  forget(path: string): void
  /**
   * List `path` through the same bounded queue (Expand all uses this, so it
   * shares the cap and never lists a folder twice at once). Resolves with the
   * next listing of `path`; rejects on error or after dispose().
   */
  load(path: string): Promise<ExplorerListDirResult>
  /** Drop every later result. */
  dispose(): void
}

export function createDirectoryLoader(deps: DirectoryLoaderDeps): DirectoryLoader {
  const maxConcurrent = deps.maxConcurrent ?? 4
  const loaded = new Set<string>()
  const inFlight = new Set<string>()
  const rerun = new Set<string>()
  const queue: string[] = []
  let running = 0
  let disposed = false
  const waiters = new Map<string, Array<{ resolve(r: ExplorerListDirResult): void; reject(e: unknown): void }>>()

  const settleWaiters = (path: string, outcome: { result: ExplorerListDirResult } | { error: unknown }): void => {
    const list = waiters.get(path)
    if (!list) return
    waiters.delete(path)
    for (const w of list) {
      if ('result' in outcome) w.resolve(outcome.result)
      else w.reject(outcome.error)
    }
  }

  const pump = (): void => {
    while (!disposed && running < maxConcurrent && queue.length > 0) {
      const path = queue.shift() as string
      start(path)
    }
  }

  const start = (path: string): void => {
    running += 1
    deps.onLoading(path)
    deps
      .listDir(deps.rootId, path)
      .then(
        (result) => {
          if (disposed) return
          loaded.add(path)
          deps.onResult(path, result)
          settleWaiters(path, { result })
        },
        (error: unknown) => {
          if (disposed) return
          loaded.delete(path)
          deps.onError(path, explorerErrorCode(error), explorerErrorMessage(error))
          settleWaiters(path, { error })
        },
      )
      .finally(() => {
        running -= 1
        inFlight.delete(path)
        if (disposed) return
        if (rerun.delete(path)) enqueue(path)
        pump()
      })
  }

  const enqueue = (path: string): void => {
    if (inFlight.has(path)) return
    inFlight.add(path)
    queue.push(path)
  }

  return {
    ensure(path) {
      if (disposed || loaded.has(path) || inFlight.has(path)) return
      enqueue(path)
      pump()
    },
    reload(paths) {
      if (disposed) return
      for (const path of paths) {
        // Queued but not started: the coming run already sees the new state.
        if (inFlight.has(path)) {
          if (!queue.includes(path)) rerun.add(path)
          continue
        }
        enqueue(path)
      }
      pump()
    },
    forget(path) {
      loaded.delete(path)
    },
    load(path) {
      if (disposed) return Promise.reject(new Error('Directory loader disposed'))
      return new Promise<ExplorerListDirResult>((resolve, reject) => {
        const list = waiters.get(path) ?? []
        list.push({ resolve, reject })
        waiters.set(path, list)
        enqueue(path)
        pump()
      })
    },
    dispose() {
      disposed = true
      queue.length = 0
      rerun.clear()
      for (const path of [...waiters.keys()]) settleWaiters(path, { error: new Error('Directory loader disposed') })
    },
  }
}

export interface ExpandAllOptions {
  start: string
  load(path: string): Promise<readonly ExplorerEntry[]>
  showDotfiles: boolean
  cap?: number
  /** Listings in flight at once (default 4, the loader's cap). */
  maxConcurrent?: number
}

/**
 * Breadth-first from `start`: returns the folders to expand, skipping
 * ignored folders and, when dotfiles are hidden, dot folders. Stops after
 * `cap` folders with `capped: true`.
 */
export async function expandAll(opts: ExpandAllOptions): Promise<{ expanded: string[]; capped: boolean }> {
  const cap = opts.cap ?? 2000
  const maxConcurrent = opts.maxConcurrent ?? 4
  const expanded: string[] = []
  let frontier = [opts.start]
  while (frontier.length > 0) {
    // List the level with at most `maxConcurrent` calls in flight; results
    // keep frontier order so the walk stays breadth-first and deterministic.
    const level = frontier
    const listings: Array<readonly ExplorerEntry[]> = new Array(level.length)
    let nextIndex = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < level.length) {
        const i = nextIndex++
        listings[i] = await opts.load(level[i]).catch(() => [] as readonly ExplorerEntry[])
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, level.length) }, worker))
    const next: string[] = []
    for (const entries of listings) {
      for (const entry of entries) {
        if (entry.kind !== 'dir' || entry.ignored) continue
        if (!opts.showDotfiles && entry.name.startsWith('.')) continue
        if (expanded.length >= cap) return { expanded, capped: true }
        expanded.push(entry.path)
        next.push(entry.path)
      }
    }
    frontier = next
  }
  return { expanded, capped: false }
}
