import { useState, useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'panopticon.ui.diff.preferences'
const CHANGE_EVENT = 'panopticon:diff-prefs-changed'

export type DiffRenderMode = 'stacked' | 'split'
export type LineDiffType = 'word-alt' | 'word' | 'char' | 'none'
export type DiffIndicators = 'classic' | 'bars' | 'none'
export type HunkSeparators = 'simple' | 'metadata' | 'line-info' | 'line-info-basic'
export type LineHoverHighlight = 'disabled' | 'both' | 'number' | 'line'

export interface DiffPreferences {
  /** Diff view mode. 'stacked' = unified, 'split' = side-by-side. Default: 'stacked' */
  diffRenderMode: DiffRenderMode
  /** Enable line wrapping in diff. Default: false */
  diffWordWrap: boolean
  /** Intra-line diff granularity. Default: 'word-alt' */
  lineDiffType: LineDiffType
  /** How change indicators render: classic +/-, bars, or none. Default: 'bars' */
  diffIndicators: DiffIndicators
  /** How collapsed hunks display. Default: 'line-info' */
  hunkSeparators: HunkSeparators
  /** Auto-expand all unchanged context. Default: false */
  expandUnchanged: boolean
  /** Lines of context before collapsing. Default: 1 */
  collapsedContextThreshold: number
  /** Line highlight on hover. Default: 'disabled' */
  lineHoverHighlight: LineHoverHighlight
  /** Hide line numbers. Default: false */
  disableLineNumbers: boolean
  /** Enable multi-line selection with shift-click. Default: false */
  enableLineSelection: boolean
}

const DEFAULTS: DiffPreferences = {
  diffRenderMode: 'stacked',
  diffWordWrap: false,
  lineDiffType: 'word-alt',
  diffIndicators: 'bars',
  hunkSeparators: 'line-info',
  expandUnchanged: false,
  collapsedContextThreshold: 1,
  lineHoverHighlight: 'disabled',
  disableLineNumbers: false,
  enableLineSelection: false,
}

function load(): DiffPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function persist(prefs: DiffPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch {
    // localStorage unavailable — ignore
  }
}

/**
 * Hook for reading and writing localStorage-backed diff panel preferences.
 * Changes dispatch a custom DOM event so all hook instances stay in sync
 * without requiring a shared React context.
 */
export function useDiffPreferences() {
  const [prefs, setPrefs] = useState<DiffPreferences>(load)
  const isSourceRef = useRef(false)

  useEffect(() => {
    const handler = () => {
      if (isSourceRef.current) {
        isSourceRef.current = false
        return
      }
      setPrefs(load())
    }
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  const update = useCallback((patch: Partial<DiffPreferences>) => {
    isSourceRef.current = true
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      persist(next)
      return next
    })
  }, [])

  return { prefs, update }
}
