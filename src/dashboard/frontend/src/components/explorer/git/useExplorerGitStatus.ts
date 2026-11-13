// useExplorerGitStatus (PAN-5186, WI-B9): git status for one explorer root.
//
// Fetches once on mount, then on the git-status-scheduler cadence: watch
// signals (debounced), and a 60 s safety run while the document is visible.
// NOT_A_GIT_REPO stops scheduling until refresh() (the header Refresh button)
// succeeds, so a plain directory root never polls git.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExplorerGitStatusResult } from '@overdeck/contracts'

import { explorerErrorCode, explorerErrorMessage, gitStatus } from '../explorer-rpc'
import { subscribeExplorerWatch } from '../watch/explorer-watch-hub'
import { buildDecorations, EMPTY_DECORATIONS, type Decorations } from './git-decoration'
import { createGitStatusScheduler, type GitStatusScheduler } from './git-status-scheduler'

export interface ExplorerGitStatusState {
  result: ExplorerGitStatusResult | null
  decorations: Decorations
  errorCode: string | undefined
  errorMessage: string | undefined
  refresh(): void
}

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

export function useExplorerGitStatus(rootId: string | undefined): ExplorerGitStatusState {
  const [result, setResult] = useState<ExplorerGitStatusResult | null>(null)
  const [error, setError] = useState<{ code: string | undefined; message: string } | null>(null)
  const schedulerRef = useRef<GitStatusScheduler | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    setResult(null)
    setError(null)
    stoppedRef.current = false
    if (!rootId) return

    let cancelled = false
    const scheduler = createGitStatusScheduler({
      run: async () => {
        if (stoppedRef.current) return
        try {
          const next = await gitStatus(rootId)
          if (cancelled) return
          setResult(next)
          setError(null)
        } catch (e) {
          if (cancelled) return
          const code = explorerErrorCode(e)
          setError({ code, message: explorerErrorMessage(e) })
          if (code === 'NOT_A_GIT_REPO') {
            stoppedRef.current = true
            setResult(null)
          }
        }
      },
    })
    schedulerRef.current = scheduler

    const unsubscribe = subscribeExplorerWatch(rootId, () => {
      if (!stoppedRef.current) scheduler.signal()
    })
    const onVisibility = () => scheduler.setActive(isVisible())
    document.addEventListener('visibilitychange', onVisibility)
    scheduler.setActive(isVisible())
    scheduler.runNow()

    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      scheduler.dispose()
      if (schedulerRef.current === scheduler) schedulerRef.current = null
    }
  }, [rootId])

  const refresh = useCallback(() => {
    stoppedRef.current = false
    schedulerRef.current?.runNow()
  }, [])

  const decorations = useMemo(() => (result ? buildDecorations(result) : EMPTY_DECORATIONS), [result])

  return { result, decorations, errorCode: error?.code, errorMessage: error?.message, refresh }
}
