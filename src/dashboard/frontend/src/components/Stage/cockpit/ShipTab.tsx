/**
 * ShipTab (PAN-2487) — the Ship & Merge view the cockpit routed to 'overview'
 * as a placeholder. The merge door runs server-side (no agent session), so this
 * renders its live progress: a step indicator (rebase → verify → merge →
 * cleanup) above the streaming door + quality-gate log from /ship-log.
 */
import { useQuery } from '@tanstack/react-query'
import { Loader2, CircleCheck, CircleX, Circle } from 'lucide-react'
import styles from './shipTab.module.css'

interface ShipLogEntry { ts: string; line: string }
interface ShipLogPayload {
  issueId: string
  mergeStatus: string | null
  mergeStep: string | null
  log: { startedAt: string; updatedAt: string; step?: string; lines: ShipLogEntry[] } | null
}

const STEPS: Array<{ key: string; label: string; matches: string[] }> = [
  { key: 'rebasing', label: 'Rebase onto main', matches: ['rebasing'] },
  { key: 'verifying', label: 'Verify (quality gates)', matches: ['verifying', 'validating-pr'] },
  { key: 'squash-merging', label: 'Merge PR', matches: ['squash-merging', 'merging'] },
  { key: 'post-merge-cleanup', label: 'Post-merge cleanup', matches: ['post-merge-cleanup'] },
]

function stepIndex(step: string | null): number {
  if (!step) return -1
  return STEPS.findIndex((s) => s.matches.includes(step))
}

export function ShipTab({ issueId }: { issueId: string }) {
  const { data } = useQuery<ShipLogPayload>({
    queryKey: ['ship-log', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/ship-log`)
      if (!res.ok) throw new Error(`ship-log ${res.status}`)
      return res.json()
    },
    refetchInterval: (query) => {
      const s = query.state.data?.mergeStatus
      return s === 'merging' || s === 'verifying' ? 2000 : 15000
    },
  })

  const mergeStatus = data?.mergeStatus ?? null
  const active = mergeStatus === 'merging' || mergeStatus === 'verifying'
  const failed = mergeStatus === 'failed'
  const merged = mergeStatus === 'merged'
  const current = stepIndex(data?.mergeStep ?? data?.log?.step ?? null)
  const lines = data?.log?.lines ?? []

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Ship — merge door</span>
        <span className={`${styles.badge} ${merged ? styles.ok : failed ? styles.bad : active ? styles.run : styles.idle}`}>
          {merged ? 'merged' : failed ? 'failed' : active ? mergeStatus : (mergeStatus ?? 'idle')}
        </span>
      </div>

      <div className={styles.steps}>
        {STEPS.map((s, i) => {
          const done = merged ? true : current > i
          const isCurrent = !merged && current === i
          return (
            <div key={s.key} className={styles.step}>
              <span className={styles.stepIcon}>
                {done ? <CircleCheck size={13} className={styles.okIcon} />
                  : isCurrent && failed ? <CircleX size={13} className={styles.badIcon} />
                  : isCurrent && active ? <Loader2 size={13} className={styles.spin} />
                  : <Circle size={13} className={styles.idleIcon} />}
              </span>
              <span className={`${styles.stepLabel} ${isCurrent ? styles.stepCurrent : ''}`}>{s.label}</span>
              {i < STEPS.length - 1 ? <span className={styles.stepBar} /> : null}
            </div>
          )
        })}
      </div>

      <div className={styles.log}>
        {lines.length === 0 ? (
          <div className={styles.empty}>
            {active
              ? 'Waiting for door output…'
              : 'No ship activity yet this session. Logs appear here live when a merge runs (the merge door is server-side — rebase, quality gates, PR merge, cleanup).'}
          </div>
        ) : (
          lines.map((e, i) => (
            <div key={i} className={styles.logLine}>
              <span className={styles.logTs}>{e.ts.slice(11, 19)}</span>
              <span className={styles.logText}>{e.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
