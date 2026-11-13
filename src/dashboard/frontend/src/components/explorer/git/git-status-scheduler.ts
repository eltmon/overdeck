// When the explorer refetches git status (PAN-5186, WI-B9; D-B16).
//
// A watch signal schedules a run 125 ms after the last signal, but never
// sooner than 3 s after the previous run started. While active (the pane is
// mounted and the document is visible), a safety run also happens 60 s after
// the previous one. The constants are Orca's
// use-worktree-git-status-observation.ts values; only the behavior is reused.
// A signal that lands while a run is in flight runs once more after it.

export interface GitStatusSchedulerOptions {
  run: () => Promise<void>
  debounceMs?: number
  minGapMs?: number
  safetyIntervalMs?: number
}

export interface GitStatusScheduler {
  signal(): void
  runNow(): void
  setActive(active: boolean): void
  dispose(): void
}

export function createGitStatusScheduler(opts: GitStatusSchedulerOptions): GitStatusScheduler {
  const debounceMs = opts.debounceMs ?? 125
  const minGapMs = opts.minGapMs ?? 3000
  const safetyIntervalMs = opts.safetyIntervalMs ?? 60_000

  let lastStart: number | null = null
  let signalTimer: ReturnType<typeof setTimeout> | null = null
  let safetyTimer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let rerun = false
  let active = false
  let disposed = false

  const clearSignal = () => {
    if (signalTimer !== null) clearTimeout(signalTimer)
    signalTimer = null
  }
  const clearSafety = () => {
    if (safetyTimer !== null) clearTimeout(safetyTimer)
    safetyTimer = null
  }

  const armSafety = () => {
    clearSafety()
    if (!active || disposed) return
    const due = (lastStart ?? Date.now()) + safetyIntervalMs
    safetyTimer = setTimeout(execute, Math.max(0, due - Date.now()))
  }

  const scheduleAt = (due: number) => {
    clearSignal()
    signalTimer = setTimeout(execute, Math.max(0, due - Date.now()))
  }

  function execute(): void {
    clearSignal()
    if (disposed) return
    if (running) {
      rerun = true
      return
    }
    running = true
    lastStart = Date.now()
    clearSafety()
    void Promise.resolve()
      .then(opts.run)
      .catch(() => {
        // run() owns its error reporting; scheduling continues.
      })
      .finally(() => {
        running = false
        if (disposed) return
        armSafety()
        if (rerun) {
          rerun = false
          scheduleAt((lastStart ?? Date.now()) + minGapMs)
        }
      })
  }

  return {
    signal() {
      if (disposed) return
      const earliest = lastStart === null ? 0 : lastStart + minGapMs
      scheduleAt(Math.max(Date.now() + debounceMs, earliest))
    },
    runNow() {
      execute()
    },
    setActive(next) {
      if (active === next) return
      active = next
      if (active && !running) armSafety()
      else if (!active) clearSafety()
    },
    dispose() {
      disposed = true
      clearSignal()
      clearSafety()
    },
  }
}
