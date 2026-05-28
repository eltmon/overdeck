import { Clock, ArrowLeftRight, FileText, MessageSquare } from 'lucide-react'
import styles from '../stage.module.css'

export interface HomeStatsInput {
  /** Workspace/issue creation time — ms epoch or ISO string. */
  createdAt?: number | string
  additions?: number
  deletions?: number
  filesChanged?: number
  conversationCount?: number
  /** Injectable clock for deterministic tests; defaults to Date.now(). */
  now?: number
}

export interface HomeStats {
  ageLabel: string
  additions: number
  deletions: number
  filesChanged: number
  conversationCount: number
}

const DAY_MS = 86_400_000

function toEpoch(value: number | string | undefined): number | null {
  if (value == null) return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Pure derivation of the HomePane stat-chip values. Degrades to neutral
 * zeros / an em-dash age when inputs are absent — never fabricates numbers. */
export function deriveHomeStats(input: HomeStatsInput): HomeStats {
  const created = toEpoch(input.createdAt)
  const now = input.now ?? Date.now()
  let ageLabel = '—'
  if (created != null && now >= created) {
    const days = Math.floor((now - created) / DAY_MS)
    ageLabel = days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`
  }
  return {
    ageLabel,
    additions: input.additions ?? 0,
    deletions: input.deletions ?? 0,
    filesChanged: input.filesChanged ?? 0,
    conversationCount: input.conversationCount ?? 0,
  }
}

/**
 * StatChips — the HomePane stat row (PAN-1549): workspace age, diff size,
 * changed-files count, and conversation count. Pure presentation composed from
 * read-model data passed by the Stage mount point. Chip click-through to panes
 * is wired in a later bead.
 */
export function StatChips(props: HomeStatsInput) {
  const stats = deriveHomeStats(props)
  return (
    <div className={styles.stats} data-testid="home-stats">
      <span className={styles.chip}>
        <Clock size={13} /> {stats.ageLabel}
      </span>
      <span className={styles.chip}>
        <ArrowLeftRight size={13} /> <span className={styles.chipAdd}>+{stats.additions}</span>{' '}
        <span className={styles.chipDel}>−{stats.deletions}</span>
      </span>
      <span className={styles.chip}>
        <FileText size={13} /> {stats.filesChanged} files
      </span>
      <span className={styles.chip}>
        <MessageSquare size={13} /> {stats.conversationCount} convos
      </span>
    </div>
  )
}
