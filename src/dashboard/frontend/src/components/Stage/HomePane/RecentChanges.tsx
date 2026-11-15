import { Bot, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import type { ProjectChanges, ProjectCommit } from '@overdeck/contracts'
import type { Conversation } from '../../CommandDeck/ConversationList'
import type { ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import { navigateToIssue } from '../../AgentPillPopoverRow'
import { cn } from '../../../lib/utils'

const TODAY_MIN = 10
const TODAY_CAP = 50
const FALLBACK_COUNT = 10

export interface RecentChangesProps {
  changes: { data?: ProjectChanges; isLoading: boolean; isError: boolean; error?: unknown }
  conversations: readonly Conversation[]
  features: readonly ProjectFeature[]
  onOpenConversation: (name: string, title: string) => void
  onSelectFeature: (feature: ProjectFeature) => void
  onAllChanges?: () => void
}

function localMidnight(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

/** PAN-5294 G-D11 — today's commits when there are at least 10 (capped at 50), else the newest 10. */
export function pickRecentCommits(commits: readonly ProjectCommit[], now: Date): { rows: ProjectCommit[]; today: boolean } {
  const midnight = localMidnight(now)
  const today = commits.filter((c) => new Date(c.authoredAt).getTime() >= midnight)
  if (today.length >= TODAY_MIN) return { rows: today.slice(0, TODAY_CAP), today: true }
  return { rows: commits.slice(0, FALLBACK_COUNT), today: false }
}

function commitTime(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  if (at.getTime() >= localMidnight(now)) {
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  }
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Who {
  label: string
  icon: 'conversation' | 'agent' | null
  open?: () => void
  hint?: string
}

function whoFor(
  commit: ProjectCommit,
  { conversations, features, onOpenConversation, onSelectFeature }: Pick<RecentChangesProps, 'conversations' | 'features' | 'onOpenConversation' | 'onSelectFeature'>,
): Who {
  const { by } = commit
  if (by.kind === 'conversation') {
    const conversation = by.id ? conversations.find((c) => c.name === by.id) : undefined
    const label = conversation?.title || by.title || by.id || 'conversation'
    if (!conversation || !by.id) {
      return { label, icon: 'conversation', hint: 'This conversation is not in the list (archived or on another machine)' }
    }
    const name = by.id
    return { label, icon: 'conversation', open: () => onOpenConversation(name, label) }
  }
  if (by.kind === 'agent' && by.title) {
    const issueId = by.title
    const feature = features.find((f) => f.issueId.toUpperCase() === issueId.toUpperCase())
    return { label: issueId, icon: 'agent', open: () => (feature ? onSelectFeature(feature) : navigateToIssue(issueId)) }
  }
  return { label: 'unattributed', icon: null }
}

function copySha(commit: ProjectCommit) {
  void navigator.clipboard?.writeText(commit.sha).then(
    () => toast(`Copied ${commit.shortSha}`),
    () => toast.error(`Could not copy ${commit.shortSha}`),
  )
}

/**
 * PAN-5294 G-D11 — Recent changes on main: who changed what, from the
 * commit trailers the changes API attributes. A conversation row opens that
 * conversation, an agent row opens its issue; unattributed rows are inert.
 */
export function RecentChanges(props: RecentChangesProps) {
  const { changes, onAllChanges } = props
  const now = new Date()
  const picked = changes.data ? pickRecentCommits(changes.data.commits, now) : null

  let body
  if (changes.isError) {
    const message = changes.error instanceof Error ? changes.error.message : String(changes.error ?? 'unknown error')
    body = <p className="px-3.5 py-3 text-[13px] text-muted-foreground">Recent changes are unavailable: {message}</p>
  } else if (!changes.data || !picked) {
    body = <p className="px-3.5 py-3 text-[13px] text-muted-foreground">Loading recent changes…</p>
  } else if (picked.rows.length === 0) {
    body = <p className="px-3.5 py-3 text-[13px] text-muted-foreground">No commits on {changes.data.branch} in the last 7 days.</p>
  } else {
    body = picked.rows.map((commit) => {
      const who = whoFor(commit, props)
      const Icon = who.icon === 'conversation' ? MessageSquare : who.icon === 'agent' ? Bot : null
      return (
        <div
          key={commit.sha}
          data-testid="recent-change-row"
          data-by={commit.by.kind}
          role={who.open ? 'button' : undefined}
          tabIndex={who.open ? 0 : undefined}
          title={who.hint}
          onClick={who.open}
          onKeyDown={who.open ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              who.open?.()
            }
          } : undefined}
          className={cn(
            'grid items-center gap-3 border-b border-border px-3.5 py-[7px] last:border-b-0',
            who.open && 'cursor-pointer hover:bg-accent',
          )}
          style={{ gridTemplateColumns: '80px minmax(0,1fr) 210px 60px' }}
        >
          <button
            type="button"
            title={`Copy ${commit.sha}`}
            aria-label={`Copy ${commit.shortSha}`}
            onClick={(event) => {
              event.stopPropagation()
              copySha(commit)
            }}
            className="justify-self-start font-mono text-[11.5px] text-primary hover:underline"
          >
            {commit.shortSha}
          </button>
          <span className="truncate text-[13px] text-foreground" title={commit.subject}>{commit.subject}</span>
          <span className={cn('flex min-w-0 items-center gap-1.5 text-[12px]', Icon ? 'text-body-foreground' : 'text-muted-foreground')}>
            {Icon && <Icon aria-hidden size={13} className="shrink-0 text-muted-foreground" />}
            <span className="truncate">{who.label}</span>
          </span>
          <span className="text-right font-mono text-[11.5px] text-muted-foreground">{commitTime(commit.authoredAt, now)}</span>
        </div>
      )
    })
  }

  return (
    <section aria-label="Recent changes on main" className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2.5">
        <h3 className="text-[14px] font-semibold text-foreground">Recent changes on main</h3>
        {picked && picked.rows.length > 0 && (
          <span className="text-[12px] text-muted-foreground">
            {picked.today ? 'who changed what, today' : 'the last 10 commits'}
          </span>
        )}
        {onAllChanges && (
          <button
            type="button"
            onClick={onAllChanges}
            className="ml-auto rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            All changes
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-[10px] border border-border bg-card">{body}</div>
    </section>
  )
}
