import { Clock, ArrowLeftRight, FileText, MessageSquare, DollarSign } from 'lucide-react'
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

export interface StatChipsProps extends HomeStatsInput {
  /** Project/workspace total spend in USD. When provided, a cost chip renders. */
  costUsd?: number
  /** Click handler for the cost chip (e.g. navigate to the costs page). */
  onCostClick?: () => void
}

/**
 * StatChips — the HomePane stat row (PAN-1549): workspace age, diff size,
 * changed-files count, conversation count, and (PAN-1589) total spend. Pure
 * presentation composed from read-model data passed by the Stage mount point.
 */
export function StatChips(props: StatChipsProps) {
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
      {props.costUsd != null && (
        props.onCostClick ? (
          <button
            type="button"
            className={styles.chip}
            onClick={props.onCostClick}
            title="View cost breakdown"
            data-testid="home-cost-chip"
          >
            <DollarSign size={13} /> ${props.costUsd.toFixed(2)}
          </button>
        ) : (
          <span className={styles.chip} data-testid="home-cost-chip">
            <DollarSign size={13} /> ${props.costUsd.toFixed(2)}
          </span>
        )
      )}
    </div>
  )
}
