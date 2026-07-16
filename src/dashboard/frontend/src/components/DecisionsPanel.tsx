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
import { AwaitingInputIndicator } from './AwaitingInputIndicator';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { useNow } from '../hooks/useNow';
import styles from './styles/decisions.module.css';

function DecisionRow({ decision }: { decision: Decision }) {
  const requestReopen = useAskUserQuestionUiStore((s) => s.requestReopen);
  const now = useNow();
  const prompt =
    decision.pendingAskUserQuestion?.questions?.[0]?.question ??
    (decision.pendingProposedPlan ? 'A plan is ready for your review.' : describePendingInput(decision.kinds));

  return (
    <div
      className={`${styles.row} ${decision.blocking ? styles.rowBlocking : ''}`}
      data-decision-id={decision.id}
      data-blocking={decision.blocking ? 'true' : undefined}
    >
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={`${styles.badge} ${decision.blocking ? styles.badgeBlocking : ''}`}>
            {describePendingInput(decision.kinds)}
          </span>
          <span className={styles.subject}>{decision.label}</span>
          {decision.source === 'conversation' && <span className={styles.chip}>Conversation</span>}
        </div>
        <p className={styles.prompt}>{prompt}</p>
        <div className={styles.meta}>
          <span className={styles.mono}>{decision.id}</span>
          {decision.since && <span>· waiting {formatRelativeTime(decision.since, now)}</span>}
        </div>
      </div>
      <button type="button" className={styles.answer} onClick={() => requestReopen(decision.id)}>
        Answer
      </button>
    </div>
  );
}

function Group({ title, hint, decisions }: { title: string; hint: string; decisions: Decision[] }) {
  if (decisions.length === 0) return null;
  return (
    <section className={styles.group}>
      <header className={styles.groupHead}>
        <span className={styles.groupTitle}>{title}</span>
        <span className={styles.groupCount}>{decisions.length}</span>
        <span className={styles.groupHint}>{hint}</span>
      </header>
      {decisions.map((d) => (
        <DecisionRow key={`${d.source}:${d.id}`} decision={d} />
      ))}
    </section>
  );
}

export function DecisionsPanel() {
  const decisions = useDecisions();
  const blocking = decisions.filter((d) => d.blocking);
  const waiting = decisions.filter((d) => !d.blocking);

  if (decisions.length === 0) {
    return (
      <div className={styles.empty} data-testid="decisions-empty">
        Nothing needs you right now.
      </div>
    );
  }

  return (
    <div className={styles.panel} data-testid="decisions-panel">
      <Group title="Blocking work" hint="An agent has stopped until you answer" decisions={blocking} />
      <Group title="Waiting" hint="Work continues; these can wait" decisions={waiting} />
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
