import type { ProjectCiSnapshot } from './types'

export type ProjectCiState = 'queued' | 'in_progress' | 'success' | 'failure'

export interface DerivedProjectCi {
  state: ProjectCiState
  completed: number
  total: number
  /** Where the chip navigates. Always an absolute github.com URL. */
  href: string
}

/** Conclusions that mean the suite failed. Mirrors FAILING_CHECK_CONCLUSIONS
 *  in src/lib/webhook-handlers.ts:196. */
const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'])

export function deriveProjectCi(record: ProjectCiSnapshot): DerivedProjectCi {
  const suites = Object.values(record.suites)
  const total = suites.length
  const completed = suites.filter((s) => s.status === 'completed').length

  const state: ProjectCiState =
    suites.some((s) => s.conclusion != null && FAILED.has(s.conclusion.toLowerCase())) ? 'failure'
    : suites.some((s) => s.status === 'in_progress') ? 'in_progress'
    : completed < total || total === 0 ? 'queued'
    : 'success'

  const only = total === 1 ? suites[0] : undefined
  const href = only?.htmlUrl
    ?? `https://github.com/${record.repo}/commit/${record.headSha}/checks`

  return { state, completed, total, href }
}
