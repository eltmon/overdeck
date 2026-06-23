import { useState } from 'react'
import {
  Compass, Code2, Eye, FlaskConical, GitMerge, Zap, Archive,
  ShieldCheck, Lock, Gauge, ClipboardList, Layers, BadgeCheck,
  ChevronRight, ChevronDown, GitPullRequest, GitBranch,
  CircleCheck, CircleX, Circle, type LucideIcon,
} from 'lucide-react'
import { useReviewStatusQuery, useWorkspaceQuery, type ReviewStatusData } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { UatStackStatus, getUatStackSummary } from '../../CommandDeck/UatStackStatus'
import type { ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import type { SessionNode } from '@overdeck/contracts'
import styles from './agentsLane.module.css'

/**
 * AgentsLane (PAN-1991 item #2) — the cockpit's left lane. Clean two-line agent
 * rows (name + status / model + runtime), convoy nesting (Review → reviewers
 * with verdicts), and Verification folded in as a step. Cockpit-only: the shared
 * ProjectNode (and the Command Deck sidebar tree it renders) is deliberately not
 * touched. Selecting an agent calls onSelectSession (→ its conversation);
 * Verification opens the Review & Verification detail (onOpenVerification).
 */

type Tone = 'info' | 'ok' | 'bad' | 'muted'

const REVIEWER_ROLE_ICON: Record<string, LucideIcon> = {
  correctness: ShieldCheck, security: Lock, performance: Gauge,
  requirements: ClipboardList, synthesis: Layers,
}

function typeIcon(session: SessionNode): LucideIcon {
  switch (session.type) {
    case 'work': return Code2
    case 'strike': return Zap
    case 'planning': return Compass
    case 'legacy': return Archive
    case 'review': return Eye
    case 'reviewer': return (session.role && REVIEWER_ROLE_ICON[session.role]) || ShieldCheck
    case 'test': return FlaskConical
    case 'ship':
    case 'merge': return GitMerge
    default: return Code2
  }
}

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s)

function sessionLabel(session: SessionNode): string {
  switch (session.type) {
    case 'planning':
    case 'legacy': return 'Plan'
    case 'work': return 'Work'
    case 'strike': return 'Strike'
    case 'review': return 'Review'
    case 'reviewer': return session.role ? cap(session.role) : 'Reviewer'
    case 'test': return 'Test'
    case 'ship':
    case 'merge': return 'Ship'
    default: return cap(session.type)
  }
}

// Some session sources report a role/placeholder ("specialist", "unknown",
// "planning") instead of a real model id. Don't render those as a model.
const MODEL_PLACEHOLDERS = new Set(['', 'unknown', 'specialist', 'planning', 'idle', 'none'])
function shortModel(m: string | undefined): string {
  const v = (m ?? '').trim()
  if (MODEL_PLACEHOLDERS.has(v.toLowerCase())) return ''
  return v.replace(/^claude-/, '')
}

function formatDur(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return ''
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

const RUNNING = new Set(['running', 'starting', 'working', 'thinking'])

function sessionStatus(session: SessionNode): { label: string; tone: Tone } {
  if (RUNNING.has(session.status)) return { label: 'running', tone: 'info' }
  if (session.status === 'error') return { label: 'error', tone: 'bad' }
  return { label: 'done', tone: 'muted' }
}

function reviewerVerdict(session: SessionNode): { label: string; tone: Tone } {
  const { latestReviewResult, latestStatus } = session.roundMetadata ?? {}
  if (latestReviewResult === 'APPROVED') return { label: 'approved', tone: 'ok' }
  if (latestReviewResult === 'CHANGES_REQUESTED' || latestStatus === 'failed' || session.status === 'error') {
    return { label: 'changes', tone: 'bad' }
  }
  if (RUNNING.has(session.status)) return { label: 'reviewing', tone: 'info' }
  return { label: 'done', tone: 'muted' }
}

const VERIFICATION_TONE: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'not run', tone: 'muted' },
  running: { label: 'running', tone: 'info' },
  passed: { label: 'passed', tone: 'ok' },
  failed: { label: 'failed', tone: 'bad' },
  skipped: { label: 'skipped', tone: 'muted' },
}

const TEST_TONE: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'not run', tone: 'muted' },
  testing: { label: 'running', tone: 'info' },
  passed: { label: 'passed', tone: 'ok' },
  failed: { label: 'failed', tone: 'bad' },
  dispatch_failed: { label: 'failed', tone: 'bad' },
  skipped: { label: 'skipped', tone: 'muted' },
}

const QUALITY_GATES = ['typecheck', 'lint', 'test'] as const

/** Per-gate breakdown — only meaningful on failure (parsed from notes), matching
 * ReviewVerificationCard.deriveGates. While running/passed all gates share the
 * aggregate state, so we only expand the breakdown when verification failed. */
function deriveFailedGates(rs: ReviewStatusData | undefined): { id: string; tone: Tone; label: string }[] {
  const m = rs?.verificationNotes?.match(/Verification FAILED at (typecheck|lint|test)\b/i)
  const failedIdx = m ? QUALITY_GATES.indexOf(m[1].toLowerCase() as (typeof QUALITY_GATES)[number]) : -1
  return QUALITY_GATES.map((id, i) => {
    if (failedIdx < 0) return { id, tone: 'bad' as Tone, label: 'failed' }
    if (i < failedIdx) return { id, tone: 'ok' as Tone, label: 'passed' }
    if (i === failedIdx) return { id, tone: 'bad' as Tone, label: 'failed' }
    return { id, tone: 'muted' as Tone, label: 'pending' }
  })
}

function Row({
  icon: Icon, tileClass, name, status, model, sub, indent, selected, expandable, expanded,
  onToggle, onClick, verdictTile,
}: {
  icon: LucideIcon
  tileClass?: string
  name: string
  status: { label: string; tone: Tone }
  model?: string
  sub?: string
  indent?: boolean
  selected?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  onClick: () => void
  verdictTile?: 'ok' | 'bad'
}) {
  return (
    <button
      type="button"
      className={`${styles.row} ${indent ? styles.child : ''} ${selected ? styles.sel : ''}`}
      onClick={onClick}
    >
      <span className={styles.caret}>
        {expandable && (
          <span
            role="button"
            tabIndex={-1}
            className={styles.caretBtn}
            onClick={(e) => { e.stopPropagation(); onToggle?.() }}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        )}
      </span>
      <span className={`${styles.tile} ${verdictTile ? styles[verdictTile] : (tileClass ?? '')}`}>
        {verdictTile === 'ok' ? <CircleCheck size={11} /> : verdictTile === 'bad' ? <CircleX size={11} /> : <Icon />}
      </span>
      <span className={styles.body}>
        <span className={styles.l1}>
          <span className={styles.name}>{name}</span>
          <span className={`${styles.status} ${styles[status.tone]}`}>{status.label}</span>
        </span>
        {(model || sub) ? (
          <span className={styles.l2}>
            <span className={styles.model}>{model ?? ''}</span>
            {sub ? <span className={styles.sub}>{sub}</span> : null}
          </span>
        ) : null}
      </span>
    </button>
  )
}

/**
 * StackDrawer (PAN-1991 #8) — the workspace stack, pinned to the bottom of the
 * lane. Replaces the old "Resources" placeholder: same place, collapsed by
 * default, but a real stack panel — health-led summary, service URLs, live
 * per-container status (reusing UatStackStatus), git ahead/behind/dirty, PRs,
 * and the real registry actions. Additive over the old drawer; the only swaps
 * are the "Resources"→"Stack" rename and trading the raw branch count for
 * branch + ahead/behind. Honest to the data: no cpu/mem, no per-container
 * logs/restart; actions are stack-level.
 */
function StackDrawer({ issueId, feature, branch }: { issueId: string; feature?: ProjectFeature; branch: string }) {
  const [open, setOpen] = useState(false)
  const ws = useWorkspaceQuery(issueId).data
  const actions = useIssueActions(issueId)
  const rd = feature?.resourceDetails
  const prs = rd?.prs ?? []
  if (!ws?.exists && !rd) return null

  const containers = ws?.containers ?? null
  const stackHealth = ws?.stackHealth
  const summary = getUatStackSummary({ containers, stackHealth })
  const total = summary?.totalCount ?? 0
  const unhealthy = !!summary && (stackHealth?.healthy === false || summary.healthyCount < summary.totalCount)
  const healthColor = !summary ? 'var(--muted-foreground)' : unhealthy ? 'var(--destructive)' : 'var(--success)'

  const git = ws?.git
  const branchName = git?.branch ?? branch
  const ahead = git?.ahead ?? 0
  const behind = git?.behind ?? 0

  const services = (ws?.services?.filter((s) => s.url) ?? []).slice()
  if (services.length === 0) {
    if (ws?.frontendUrl) services.push({ name: 'Frontend', url: ws.frontendUrl })
    if (ws?.apiUrl) services.push({ name: 'API', url: ws.apiUrl })
  }

  const stackActions = ['rebuildAndStart', 'syncMain', 'createWorkspace']
    .map((key) => actions.all.find((v) => v.action.key === key))
    .filter((v): v is IssueActionView => !!v && v.enabled)

  return (
    <div className={styles.resources}>
      <button type="button" className={styles.resToggle} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Stack
        <span className="sum" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className={styles.dot} style={{ background: healthColor }} />
          {total > 0 ? `${total} ctr` : 'no ctr'}{ahead > 0 ? ` · +${ahead}` : ''} · {prs.length} PR
        </span>
      </button>
      {open && (
        <div className={styles.resList}>
          {services.length > 0 && (
            <>
              <div className={styles.resSub}>Services</div>
              <div className={styles.resRow} style={{ gap: 12 }}>
                {services.map((s) => (
                  <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" className={styles.resLink}>{s.name} ↗</a>
                ))}
              </div>
            </>
          )}

          {(containers || stackHealth) && (
            <>
              <div className={styles.resSub}>Containers{total ? ` · ${total}` : ''}</div>
              <UatStackStatus density="compact" containers={containers} stackHealth={stackHealth} frontendUrl={ws?.frontendUrl} apiUrl={ws?.apiUrl} />
            </>
          )}

          {prs.length > 0 && (
            <>
              <div className={styles.resSub}>Pull requests</div>
              {prs.map((pr) => (
                <div key={pr.number} className={styles.resRow}>
                  <GitPullRequest className="ri" />
                  <span>#{pr.number}</span>
                  <span className="rmeta">{pr.isDraft ? 'draft' : pr.state.toLowerCase()}</span>
                </div>
              ))}
            </>
          )}

          <div className={styles.resSub}>Git</div>
          <div className={styles.resRow}>
            <GitBranch className="ri" />
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px' }}>{branchName}</span>
            <span className="rmeta">
              {ahead > 0 ? `+${ahead}` : ''}{behind > 0 ? ` -${behind}` : ''}{git?.dirty ? ' dirty' : (!ahead && !behind ? 'clean' : '')}
            </span>
          </div>

          {stackActions.length > 0 && (
            <div className={styles.resActions}>
              {stackActions.map((v) => (
                <button key={v.action.key} type="button" disabled={v.isPending} onClick={v.invoke} className={styles.resBtn}>
                  {v.action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AgentsLane({
  issueId, sessions, feature, branch, selectedSessionId, onSelectSession, onOpenVerification,
}: {
  issueId: string
  sessions: readonly SessionNode[]
  feature?: ProjectFeature
  branch: string
  selectedSessionId: string | null
  onSelectSession: (session: SessionNode) => void
  onOpenVerification: () => void
}) {
  const [reviewExpanded, setReviewExpanded] = useState(true)
  const [verExpanded, setVerExpanded] = useState(true)
  const review = useReviewStatusQuery(issueId)
  const rs = review.data

  const plan = sessions.find((s) => s.type === 'planning' || s.type === 'legacy')
  const works = sessions.filter((s) => s.type === 'work' || s.type === 'strike')
  const reviewParent = sessions.find((s) => s.type === 'review')
  const reviewers = sessions.filter((s) => s.type === 'reviewer')
  const testSession = sessions.find((s) => s.type === 'test')
  const ships = sessions.filter((s) => s.type === 'ship' || s.type === 'merge')

  const changesCount = reviewers.filter((r) => reviewerVerdict(r).tone === 'bad').length
  const verState = VERIFICATION_TONE[rs?.verificationStatus ?? 'pending'] ?? VERIFICATION_TONE.pending
  const verFailed = rs?.verificationStatus === 'failed'

  // count = real agent rows + verification step (+ synthetic test if no session)
  const count = [plan, ...works, reviewParent, testSession, ...ships].filter(Boolean).length + 1 + (testSession ? 0 : 1)

  return (
    <div>
      <div className={styles.header}>Agents &amp; steps <span className="n">{count}</span></div>

      {plan && (
        <Row icon={typeIcon(plan)} verdictTile={plan.status === 'error' ? 'bad' : 'ok'}
          name="Plan" status={sessionStatus(plan)} model={shortModel(plan.model)} sub={formatDur(plan.duration)}
          selected={plan.sessionId === selectedSessionId} onClick={() => onSelectSession(plan)} />
      )}

      {works.map((w) => (
        <Row key={w.sessionId} icon={typeIcon(w)} tileClass={styles.work}
          name={sessionLabel(w)} status={sessionStatus(w)} model={shortModel(w.model)} sub={formatDur(w.duration)}
          selected={w.sessionId === selectedSessionId} onClick={() => onSelectSession(w)} />
      ))}

      {reviewParent && (
        <Row icon={Eye} tileClass={styles.review}
          name="Review"
          status={reviewers.length ? { label: `${reviewers.length} reviewers`, tone: 'muted' } : sessionStatus(reviewParent)}
          model={shortModel(reviewParent.model)}
          sub={reviewers.length ? `convoy · ${changesCount} changes` : formatDur(reviewParent.duration)}
          expandable={reviewers.length > 0} expanded={reviewExpanded} onToggle={() => setReviewExpanded((v) => !v)}
          selected={reviewParent.sessionId === selectedSessionId} onClick={() => onSelectSession(reviewParent)} />
      )}
      {reviewParent && reviewExpanded && reviewers.map((r) => (
        <Row key={r.sessionId} icon={typeIcon(r)} indent
          name={sessionLabel(r)} status={reviewerVerdict(r)} model={shortModel(r.model)}
          selected={r.sessionId === selectedSessionId} onClick={() => onSelectSession(r)} />
      ))}

      {/* Verification — a step, not a session. Aggregate status; on failure expands to the gates. */}
      <Row icon={BadgeCheck} tileClass={styles.ver}
        name="Verification" status={verState} model="build gate"
        sub={rs?.verificationCycleCount ? `cycle ${rs.verificationCycleCount}${rs.verificationMaxCycles ? `/${rs.verificationMaxCycles}` : ''}` : undefined}
        expandable={verFailed} expanded={verExpanded} onToggle={() => setVerExpanded((v) => !v)}
        onClick={onOpenVerification} />
      {verFailed && verExpanded && deriveFailedGates(rs).map((g) => (
        <Row key={g.id} icon={Circle} indent name={cap(g.id)} status={{ label: g.label, tone: g.tone }}
          verdictTile={g.tone === 'ok' ? 'ok' : g.tone === 'bad' ? 'bad' : undefined}
          onClick={onOpenVerification} />
      ))}

      {/* Test — its session if dispatched (click → its terminal/output), else a synthetic step. */}
      {testSession ? (
        <Row icon={FlaskConical} name="Test" status={sessionStatus(testSession)} model={shortModel(testSession.model)}
          sub={formatDur(testSession.duration)} selected={testSession.sessionId === selectedSessionId}
          onClick={() => onSelectSession(testSession)} />
      ) : (
        <Row icon={FlaskConical} name="Test" status={TEST_TONE[rs?.testStatus ?? 'pending'] ?? TEST_TONE.pending}
          model="pipeline" onClick={onOpenVerification} />
      )}

      {ships.map((s) => (
        <Row key={s.sessionId} icon={typeIcon(s)} name="Ship" status={sessionStatus(s)} model={shortModel(s.model)}
          sub={formatDur(s.duration)} selected={s.sessionId === selectedSessionId} onClick={() => onSelectSession(s)} />
      ))}

      <StackDrawer issueId={issueId} feature={feature} branch={branch} />
    </div>
  )
}
