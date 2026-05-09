/**
 * Diff worker pool provider — wraps @pierre/diffs WorkerPoolContextProvider.
 * Adapted from T3Code's DiffWorkerPoolProvider.tsx for Panopticon.
 */

import { WorkerPoolContextProvider, useWorkerPool } from '@pierre/diffs/react'
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useTheme } from '../hooks/useTheme'
import { resolveDiffThemeName, type DiffThemeName } from '../lib/diffRendering'

function DiffWorkerThemeSync({ themeName }: { themeName: DiffThemeName }) {
  const workerPool = useWorkerPool()
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!workerPool) {
      return
    }

    const current = workerPool.getDiffRenderOptions()
    if (initializedRef.current && current.theme === themeName) {
      return
    }
    initializedRef.current = true

    void workerPool
      .setRenderOptions({
        ...current,
        theme: themeName,
      })
      .catch(() => undefined)
  }, [themeName, workerPool])

  return null
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const { resolvedTheme } = useTheme()
  const diffThemeName = resolveDiffThemeName(resolvedTheme)
  const workerPoolSize = useMemo(() => {
    const cores =
      typeof navigator === 'undefined' ? 4 : Math.max(1, navigator.hardwareConcurrency || 4)
    return Math.max(2, Math.min(6, Math.floor(cores / 2)))
  }, [])

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new DiffsWorker(),
        poolSize: workerPoolSize,
        totalASTLRUCacheSize: 240,
      }}
      highlighterOptions={{
        theme: diffThemeName,
        tokenizeMaxLineLength: 1_000,
      }}
    >
      <DiffWorkerThemeSync themeName={diffThemeName} />
      {children}
    </WorkerPoolContextProvider>
  )
}
