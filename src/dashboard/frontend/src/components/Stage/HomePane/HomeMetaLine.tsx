import { useRef, useState, type SyntheticEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { deriveProjectCi } from '@overdeck/contracts'
import { selectProjectCi, useDashboardStore } from '../../../lib/store'
import { formatRelativeTime } from '../../../lib/dashboard-utils'
import { abbreviateHome } from '../../chat/header/ConversationStatusLine'
import { MenuOverlay, PopoverSurface } from '../../shared/ContextMenu'
import { ProjectDeployChip } from '../../CommandDeck/ProjectDeployChip'
import { ProjectIdentityChip } from '../../CommandDeck/ProjectTree/ProjectIdentityChip'
import { ProjectReleasePanel } from './ProjectReleasePanel'
import styles from './home.module.css'

/** The fields of `/api/projects/:key/release-status` this line reads. */
interface ReleaseStatus {
  available: boolean
  runs: Array<{ tag: string; status: string; conclusion: string | null; updatedAt: string }>
}

export interface HomeMetaLineProps {
  projectKey: string
  /** The registered checkout path; shown with the home directory as `~`. */
  path?: string
  branch: string
}

interface ReleaseWord {
  text: string
  className?: string
}

/** PAN-5294 G-D3 — the release segment's words, or null while unknown. */
export function releaseWord(status: ReleaseStatus | undefined): ReleaseWord | null {
  if (!status) return null
  if (!status.available) return { text: 'no releases' }
  const latest = status.runs[0]
  if (!latest) return { text: 'no release runs yet' }
  if (latest.status !== 'completed') return { text: `releasing ${latest.tag}…`, className: 'text-state-live' }
  if (latest.conclusion === 'success') return { text: `${latest.tag} released ${formatRelativeTime(latest.updatedAt)}` }
  return { text: `${latest.tag} release failed`, className: 'text-destructive' }
}

function ReleaseSegment({ projectKey }: { projectKey: string }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Same key as ProjectReleasePanel, so the line and the popover share one cache entry.
  const { data } = useQuery({
    queryKey: ['projectReleaseStatus', projectKey],
    queryFn: async (): Promise<ReleaseStatus> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/release-status`)
      if (!res.ok) throw new Error('Failed to fetch release status')
      return res.json()
    },
    refetchInterval: 60_000,
  })
  const word = releaseWord(data)
  if (!word) return null
  if (!data?.available) return <span className={word.className}>{word.text}</span>

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.metaButton} ${word.className ?? ''}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {word.text}
      </button>
      {open && (
        <>
          <MenuOverlay onClick={() => setOpen(false)} />
          <PopoverSurface
            aria-label="Release details"
            onClose={() => setOpen(false)}
            returnFocusRef={buttonRef}
            className={styles.releasePopover}
          >
            <ProjectReleasePanel projectKey={projectKey} />
          </PopoverSurface>
        </>
      )}
    </>
  )
}

const CI_CLASS = {
  success: 'text-state-done',
  failure: 'text-destructive',
  queued: 'text-state-live',
  in_progress: 'text-state-live',
} as const

function CiWord({ projectKey }: { projectKey: string }) {
  const record = useDashboardStore(selectProjectCi(projectKey))
  if (!record || Object.keys(record.suites).length === 0) return <span>CI unknown</span>

  const { state, completed, total, href } = deriveProjectCi(record)
  const text = state === 'success' ? 'CI passing'
    : state === 'failure' ? 'CI failing'
    : `CI running ${completed}/${total}`
  const open = (event: SyntheticEvent) => {
    event.stopPropagation()
    window.open(href, '_blank', 'noopener,noreferrer')
  }
  return (
    <span
      role="link"
      tabIndex={0}
      data-ci-state={state}
      className={`${styles.metaButton} ${CI_CLASS[state]}`}
      title={`${record.branch} @ ${record.headSha.slice(0, 7)} — ${state} (${completed}/${total} workflows)`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') open(event)
      }}
    >
      {text}
    </span>
  )
}

/**
 * PAN-5294 G-D3 — path · branch · release · CI word · deploy · identity.
 * A segment whose source is absent renders nothing and takes no separator.
 */
export function HomeMetaLine({ projectKey, path, branch }: HomeMetaLineProps) {
  return (
    <div className={styles.metaLine} data-testid="home-meta-line">
      <span className={styles.metaItem}>{path ? abbreviateHome(path) : null}</span>
      <span className={styles.metaItem}>{branch}</span>
      <span className={styles.metaItem}><ReleaseSegment projectKey={projectKey} /></span>
      <span className={styles.metaItem}><CiWord projectKey={projectKey} /></span>
      <span className={styles.metaItem}><ProjectDeployChip projectKey={projectKey} /></span>
      <span className={styles.metaItem}><ProjectIdentityChip projectKey={projectKey} /></span>
    </div>
  )
}
