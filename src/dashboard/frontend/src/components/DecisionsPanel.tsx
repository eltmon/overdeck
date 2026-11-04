/**
 * DecisionsPanel — every dialog waiting on the operator, in one list.
 *
 * Grouped by consequence rather than by kind: kind tells you what the dialog is,
 * consequence tells you whether it matters. "Blocking work" means an agent has
 * stopped dead; "Waiting" means work continues around it.
 *
 * Color discipline: every row here is "a human must act", which is amber by the
 * style guide's table — so painting all of them amber would mean nothing reads.
 * Amber identifies the surface (the count, the triangle); each row carries a
 * status left-border plus exactly one colored badge (its kind); red is spent
 * only on genuinely stopped agents.
 */
import { useAskUserQuestionUiStore } from '../lib/askUserQuestionUiStore';
import { useDecisions, type Decision } from '../lib/useDecisions';
import { describePendingInput } from '../lib/pendingInput';
import { getPendingQuestionTitle } from '../lib/pipeline-state';
import { AgentRequestCard } from './AgentRequestCard';
import { McpSignInCard } from './McpSignInCard';
import { AwaitingInputIndicator } from './AwaitingInputIndicator';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { formatIssueRef } from '../lib/issueLabel';
import { useNow } from '../hooks/useNow';
import { navigateToDecisionSubject } from '../lib/navigateToDecision';
import { selectAgents, useDashboardStore } from '../lib/store';
import styles from './styles/decisions.module.css';

/**
 * PAN-4849 — Deft's `external` escalations are "dashboard indicator, no
 * interrupt": a quiet line per agent, never a decision, never in the count.
 */
function DeftExternalNotes() {
  const agents = useDashboardStore(selectAgents);
  const waiting = agents.filter((agent) => (agent.deftExternalEscalations ?? 0) > 0);
  if (waiting.length === 0) return null;
  return (
    <ul className={styles.meta} data-testid="deft-external-notes">
      {waiting.map((agent) => (
        <li key={agent.id}>
          {agent.issueId ?? agent.id} · Deft: waiting on external ({agent.deftExternalEscalations})
        </li>
      ))}
    </ul>
  );
}

/** PAN-4849 — SLA and dangerous chips for a Deft escalation, read from the context the server wrote. */
function deftEscalationChips(decision: Decision): string[] {
  const question = decision.pendingAskUserQuestion;
  if (!question?.toolUseId?.startsWith('deft-escalation:')) return [];
  const context = question.questions?.[0]?.context ?? '';
  const sla = /SLA (\d+)h/.exec(context)?.[1];
  return [...(sla ? [`SLA ${sla}h`] : []), ...(context.split('\n').includes('DANGEROUS') ? ['dangerous'] : [])];
}

function DecisionRow({ decision, onOpenSubject }: { decision: Decision; onOpenSubject?: (d: Decision) => void }) {
  const requestReopen = useAskUserQuestionUiStore((s) => s.requestReopen);
  const now = useNow();
  const enrichmentTitle = decision.pendingQuestionPrompt
    ? getPendingQuestionTitle({
        pendingQuestionPrompt: decision.pendingQuestionPrompt,
        pendingQuestionReason: decision.pendingQuestionReason,
        pendingQuestionCount: 1,
      })
    : undefined;
  // PAN-4596 (D9) — a held kickoff has no dialog for Answer to reopen; its row
  // offers one Open that goes to the conversation, where Start sends it.
  const heldOnly = decision.kinds.length === 1 && decision.kinds[0] === 'heldKickoff';
  const heldPrompt = heldOnly ? decision.heldKickoffFocus ?? 'Its kickoff was never sent. Open the conversation to start it.' : undefined;
  const prompt =
    decision.pendingAskUserQuestion?.questions?.[0]?.question ??
    (decision.pendingProposedPlan ? 'A plan is ready for your review.' : enrichmentTitle ?? decision.permissionSummary ?? heldPrompt ?? describePendingInput(decision.kinds, decision.turnEndAssessment));
  const issueRef = formatIssueRef(decision.issueId, decision.issueTitle);
  const deftChips = deftEscalationChips(decision);

  return (
    <div
      className={`${styles.row} ${decision.blocking ? styles.rowBlocking : ''}`}
      data-decision-id={decision.id}
      data-blocking={decision.blocking ? 'true' : undefined}
    >
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={`${styles.badge} ${decision.blocking ? styles.badgeBlocking : ''}`}>
            {describePendingInput(decision.kinds, decision.turnEndAssessment)}
          </span>
          <span className={styles.subject}>{decision.label}</span>
          {decision.source === 'conversation' && issueRef && (
            <span className={styles.subject}>{issueRef}</span>
          )}
          {decision.source === 'conversation' && <span className={styles.chip}>Conversation</span>}
          {deftChips.map((chip) => <span key={chip} className={styles.chip}>{chip}</span>)}
        </div>
        <p className={styles.prompt}>{prompt}</p>
        <div className={styles.meta}>
          <span className={styles.mono}>{decision.id}</span>
          {decision.machineLabel && <span>· on {decision.machineLabel}</span>}
          {decision.since && <span>· waiting {formatRelativeTime(decision.since, now)}</span>}
        </div>
      </div>
      {decision.remote ? (
        // PAN-4651 D-4651-15 — a linked machine's conversation opens through the proxy; its agents are answered there.
        decision.source === 'conversation' && (
          <button type="button" className={styles.answer} title={`Go to the conversation on ${decision.machineLabel}`} onClick={() => navigateToDecisionSubject(decision)}>
            Open
          </button>
        )
      ) : heldOnly ? (
        <button
          type="button"
          className={styles.answer}
          title="Go to the conversation"
          onClick={() => (onOpenSubject ? onOpenSubject(decision) : navigateToDecisionSubject(decision))}
        >
          Open
        </button>
      ) : onOpenSubject && (
        <button
          type="button"
          className={styles.answer}
          title={decision.source === 'conversation' ? 'Go to the conversation' : 'Open the issue'}
          onClick={() => onOpenSubject(decision)}
        >
          Open
        </button>
      )}
      {!heldOnly && !decision.remote && (
        <button type="button" className={styles.answer} onClick={() => requestReopen(decision.id)}>
          Answer
        </button>
      )}
    </div>
  );
}

function Group({ title, hint, decisions, onOpenSubject }: { title: string; hint: string; decisions: Decision[]; onOpenSubject?: (d: Decision) => void }) {
  if (decisions.length === 0) return null;
  return (
    <section className={styles.group}>
      <header className={styles.groupHead}>
        <span className={styles.groupTitle}>{title}</span>
        <span className={styles.groupCount}>{decisions.length}</span>
        <span className={styles.groupHint}>{hint}</span>
      </header>
      {decisions.map((d) => (
        // PAN-4946 — an MCP sign-in has its own card, checked before agentRequest.
        d.mcpSignIn
          ? <McpSignInCard key={`mcp-sign-in:${d.id}`} decision={d} />
          // PAN-4941 (D-9) — a secret request has its own card and never the generic Answer button.
          : d.agentRequest
          ? <AgentRequestCard key={`request:${d.id}`} decision={d} />
          : <DecisionRow key={`${d.source}:${d.id}`} decision={d} onOpenSubject={onOpenSubject} />
      ))}
    </section>
  );
}

export function DecisionsPanel({ onOpenSubject }: { onOpenSubject?: (d: Decision) => void } = {}) {
  const decisions = useDecisions();
  const blocking = decisions.filter((d) => d.blocking);
  const waiting = decisions.filter((d) => !d.blocking);

  if (decisions.length === 0) {
    return (
      <>
        <div className={styles.empty} data-testid="decisions-empty">
          Nothing needs you right now.
        </div>
        <DeftExternalNotes />
      </>
    );
  }

  return (
    <div className={styles.panel} data-testid="decisions-panel">
      <Group title="Blocking work" hint="An agent has stopped until you answer" decisions={blocking} onOpenSubject={onOpenSubject} />
      <Group title="Waiting" hint="Work continues; these can wait" decisions={waiting} onOpenSubject={onOpenSubject} />
      <DeftExternalNotes />
    </div>
  );
}

/** The persistent signal — the count of everything waiting on the operator. */
export function DecisionsCount() {
  const decisions = useDecisions();
  if (decisions.length === 0) return null;
  return (
    <span className={styles.count} data-testid="decisions-count" title={`${decisions.length} waiting on you`}>
      <AwaitingInputIndicator kinds={decisions.flatMap((d) => d.kinds)} size={11} />
      {decisions.length}
    </span>
  );
}
