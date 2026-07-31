import { useState } from 'react'
import {
  ChevronRight, ChevronDown, GitPullRequest, GitBranch,
  Loader2,
} from 'lucide-react'
import { useIssueCostsQuery, useReviewStatusQuery, useWorkspaceQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { UatStackStatus, getUatStackSummary } from '../../CommandDeck/UatStackStatus'
import type { ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import type { SessionNode } from '@overdeck/contracts'
import { AgentStepRow } from '../../issue-view/AgentStepRow'
import { VerificationGates } from '../../issue-view/VerificationGates'
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

function sessionStatus(session: SessionNode): { label: string; tone: Tone } {
  const RUNNING = new Set(['running', 'starting', 'working', 'thinking'])
  if (RUNNING.has(session.status)) return { label: 'running', tone: 'info' }
  if (session.status === 'error') return { label: 'error', tone: 'bad' }
  return { label: 'done', tone: 'ok' }
}

/** Non-agent lane step (Verification, synthetic Test) — no context menu. */
function InfoRow({
  name, status, model, sub, cost, indent, selected, expandable, expanded,
  onToggle, onClick,
}: {
  name: string
  status: { label: string; tone: Tone }
  model?: string
  sub?: string
  cost?: string
  indent?: boolean
  selected?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={`${name} — ${status.label}`}
      className={`${styles.row} ${indent ? styles.child : ''} ${selected ? styles.sel : ''}`}
      onClick={onClick}
    >
      <span className={styles.caret}>
        {expandable ? (
          <span
            role="button"
            tabIndex={-1}
            className={styles.caretBtn}
            onClick={(e) => { e.stopPropagation(); onToggle?.() }}
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : null}
      </span>
      <span className={`${styles.syntheticDot} ${styles[`dot-${status.tone}`]}`} aria-hidden="true" />
      <span className={styles.body}>
        <span className={styles.l1}>
          <span className={styles.name}>{name}</span>
          {cost ? <span className={styles.cost}>{cost}</span> : null}
        </span>
        <span className={styles.l2}>
          <span className={styles.model}>{model ?? 'pipeline'}</span>
          {sub ? <span className={styles.sub}>{sub}</span> : null}
          <span className={`${styles.status} ${styles[status.tone]}`}>
            {status.tone === 'info' ? <Loader2 size={9} className={styles.spin} /> : null}
            {status.label}
          </span>
        </span>
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
function StackDrawer({
  issueId,
  feature,
  branch,
  onExpandSpine,
}: {
  issueId: string
  feature?: ProjectFeature
  branch: string
  onExpandSpine: () => void
}) {
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
  const stackStatus = summary?.label ?? 'Stack status unavailable'
  const compactLabel = `${stackStatus}. ${ahead > 0 ? `${ahead} commit${ahead === 1 ? '' : 's'} ahead. ` : ''}${prs.length} pull request${prs.length === 1 ? '' : 's'}. Expand agent spine for details.`

  const services = (ws?.services?.filter((s) => s.url) ?? []).slice()
  if (services.length === 0) {
    if (ws?.frontendUrl) services.push({ name: 'Frontend', url: ws.frontendUrl })
    if (ws?.apiUrl) services.push({ name: 'API', url: ws.apiUrl })
  }

  const stackActions = ['rebuildAndStart', 'syncMain', 'createWorkspace']
    .map((key) => actions.all.find((v) => v.action.key === key))
    .filter((v): v is IssueActionView => !!v && v.enabled)

  return (
    <div className={styles.resources} data-section="StackDrawer">
      <button
        type="button"
        className={styles.resCompact}
        data-testid="stack-compact-control"
        aria-label={compactLabel}
        title={compactLabel}
        onClick={() => {
          setOpen(true)
          onExpandSpine()
        }}
      >
        <span className={styles.dot} style={{ background: healthColor }} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.resToggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
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

/** PAN-2393: per-session cost lookup — every line item shows what IT cost.
 * Sourced from the same per-issue cost data the Costs page uses (one read
 * door, no parallel rollup). Matches by sessionId, falling back to agentId
 * ~ tmux session name. Used here for non-agent InfoRow steps. */
function useSessionCostLookup(issueId: string): (session: SessionNode) => string | undefined {
  const costs = useIssueCostsQuery(issueId)
  const sessions = costs.data?.sessions ?? []
  return (session: SessionNode) => {
    const hit = sessions.find((entry) =>
      entry.sessionId === session.sessionId
      || (entry.agentId && (entry.agentId === session.tmuxSession || entry.agentId === session.sessionId)))
    if (!hit?.cost || hit.cost <= 0) return undefined
    const tokens = hit.tokenCount && hit.tokenCount > 0
      ? ` · ${hit.tokenCount >= 1_000_000 ? `${(hit.tokenCount / 1_000_000).toFixed(1)}M` : `${Math.round(hit.tokenCount / 1_000)}k`} tok`
      : ''
    return `$${hit.cost.toFixed(2)}${tokens}`
  }
}

export function AgentsLane({
  issueId, sessions, feature, branch, selectedSessionId, onSelectSession, onOpenVerification, onExpandSpine,
}: {
  issueId: string
  sessions: readonly SessionNode[]
  feature?: ProjectFeature
  branch: string
  selectedSessionId: string | null
  onSelectSession: (session: SessionNode) => void
  onOpenVerification: () => void
  onExpandSpine: () => void
}) {
  const [reviewExpanded, setReviewExpanded] = useState(true)
  const [verExpanded, setVerExpanded] = useState(true)
  const review = useReviewStatusQuery(issueId)
  const rs = review.data

  const costOf = useSessionCostLookup(issueId)
  const plan = sessions.find((s) => s.type === 'planning' || s.type === 'legacy')
  const works = sessions.filter((s) => s.type === 'work' || s.type === 'strike')
  const knowledges = sessions.filter((s) => s.type === 'knowledge')
  const reviewParent = sessions.find((s) => s.type === 'review')
  const reviewers = sessions.filter((s) => s.type === 'reviewer')
  const testSession = sessions.find((s) => s.type === 'test')
  const ships = sessions.filter((s) => s.type === 'ship' || s.type === 'merge')

  const verState = VERIFICATION_TONE[rs?.verificationStatus ?? 'pending'] ?? VERIFICATION_TONE.pending
  const verFailed = rs?.verificationStatus === 'failed'

  // count = real agent rows + verification step (+ synthetic test if no session)
  const count = [plan, ...works, ...knowledges, reviewParent, testSession, ...ships].filter(Boolean).length + 1 + (testSession ? 0 : 1)
  const activeCount = sessions.filter((session) => session.presence === 'active').length

  return (
    <div data-section="AgentsLane">
      <div data-section="CrewStage">
        <div className={styles.header}>
          The crew <span className={styles.n}>{count}</span>
          <span className={styles.presence}>{activeCount > 0 ? `${activeCount} working` : 'all idle'}</span>
        </div>

        {plan && (
        <InfoRow
          name="Plan"
          status={sessionStatus(plan)}
          model={plan.model}
          sub={plan.duration ? `${Math.round(plan.duration / 60)}m` : undefined}
          cost={costOf(plan)}
          selected={plan.sessionId === selectedSessionId}
          onClick={() => onSelectSession(plan)}
        />
      )}

      {works.map((w) => (
        <AgentStepRow
          key={w.sessionId}
          session={w}
          issueId={issueId}
          density="cockpit"
          isSelected={w.sessionId === selectedSessionId}
          onClick={() => onSelectSession(w)}
          showMenu={false}
          onAction={() => {}}
        />
      ))}

      {knowledges.map((k) => (
        <AgentStepRow
          key={k.sessionId}
          session={k}
          issueId={issueId}
          density="cockpit"
          isSelected={k.sessionId === selectedSessionId}
          onClick={() => onSelectSession(k)}
          showMenu={false}
          onAction={() => {}}
        />
      ))}

      {reviewParent && (
        <AgentStepRow
          session={reviewParent}
          issueId={issueId}
          density="cockpit"
          isSelected={reviewParent.sessionId === selectedSessionId}
          expandable={reviewers.length > 0}
          expanded={reviewExpanded}
          onToggleExpand={() => setReviewExpanded((v) => !v)}
          onClick={() => onSelectSession(reviewParent)}
          showMenu={false}
          onAction={() => {}}
        />
      )}
      {reviewParent && reviewExpanded && reviewers.length > 0 ? (
        <div className={styles.reviewChildren} data-testid="review-convoy">
          {reviewers.map((r) => (
            <AgentStepRow
              key={r.sessionId}
              session={r}
              issueId={issueId}
              density="cockpit"
              isSelected={r.sessionId === selectedSessionId}
              onClick={() => onSelectSession(r)}
              showMenu={false}
              onAction={() => {}}
            />
          ))}
        </div>
      ) : null}

      {/* Verification — a step, not a session. Aggregate status; on failure expands to the gates. */}
      <InfoRow
        name="Verification" status={verState} model="build gate"
        sub={rs?.verificationCycleCount ? `cycle ${rs.verificationCycleCount}${rs.verificationMaxCycles ? `/${rs.verificationMaxCycles}` : ''}` : undefined}
        expandable={verFailed} expanded={verExpanded} onToggle={() => setVerExpanded((v) => !v)}
        onClick={onOpenVerification} />
      {verFailed && verExpanded && <VerificationGates issueId={issueId} />}

      {/* Test — its session if dispatched (click → its terminal/output), else a synthetic step. */}
      {testSession ? (
        <AgentStepRow
          session={testSession}
          issueId={issueId}
          density="cockpit"
          isSelected={testSession.sessionId === selectedSessionId}
          onClick={() => onSelectSession(testSession)}
          showMenu={false}
          onAction={() => {}}
        />
      ) : (
        <InfoRow name="Test" status={TEST_TONE[rs?.testStatus ?? 'pending'] ?? TEST_TONE.pending}
          model="pipeline" onClick={onOpenVerification} />
      )}

        {ships.map((s) => (
          <AgentStepRow
            key={s.sessionId}
            session={s}
            issueId={issueId}
            density="cockpit"
            isSelected={s.sessionId === selectedSessionId}
            onClick={() => onSelectSession(s)}
            showMenu={false}
            onAction={() => {}}
          />
        ))}
      </div>

      <StackDrawer issueId={issueId} feature={feature} branch={branch} onExpandSpine={onExpandSpine} />
    </div>
  )
}
