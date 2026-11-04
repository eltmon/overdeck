/**
 * MobileNeedsYou — the phone Needs-you list and question card (PAN-2355 FR-4, D-13).
 *
 * Rows come from `useDecisions()`, blocking first. The `?subject=` row, or else
 * the first answerable question, opens as a card. A card answers through
 * `pendingInputAnswer.ts`, the same transports the desktop dialog uses, so an
 * agent, a pi conversation, any other conversation and a Codex approval each
 * reach their own endpoint. Every other kind is read-only here: a conversation
 * gets **Open**, an agent says to answer on the desktop.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDecisions, type Decision } from '../../lib/useDecisions';
import { useAskUserQuestionUiStore } from '../../lib/askUserQuestionUiStore';
import { buildPendingAnswerRequest, postPendingAnswer, type PendingAnswerTarget } from '../../lib/pendingInputAnswer';
import { describePendingInput } from '../../lib/pendingInput';
import { formatRelativeTime } from '../../lib/formatRelativeTime';

type PendingQuestion = NonNullable<Decision['pendingAskUserQuestion']>;

function answerableQuestion(decision: Decision): PendingQuestion | null {
  const pending = decision.pendingAskUserQuestion;
  if (!decision.kinds.includes('askUserQuestion') || !pending || pending.questions.length === 0) return null;
  return pending;
}

function openConversation(id: string): void {
  window.history.pushState({}, '', `/m?conversation=${encodeURIComponent(id)}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function QuestionCard({ decision, pending, error, onError }: {
  decision: Decision;
  pending: PendingQuestion;
  /** Held by the list: marking the question answered unmounts this card until a failure un-marks it. */
  error: string | undefined;
  onError: (toolUseId: string, message: string | undefined) => void;
}) {
  const markAnswered = useAskUserQuestionUiStore((s) => s.markAnswered);
  const unmarkAnswered = useAskUserQuestionUiStore((s) => s.unmarkAnswered);
  const { questions, toolUseId } = pending;
  const isCodexApproval = toolUseId.startsWith('codex-approval:');
  const [selections, setSelections] = useState<string[]>(() => questions.map(() => ''));
  const [typing, setTyping] = useState(false);
  const [customText, setCustomText] = useState('');
  const [sending, setSending] = useState(false);

  const custom = customText.trim();
  const allSelected = selections.every((s) => s.length > 0);
  const canSend = !sending && (custom.length > 0 || allSelected);

  const send = async () => {
    if (!canSend) return;
    const target: PendingAnswerTarget = {
      kind: decision.source === 'agent' ? 'agent' : 'conv',
      id: decision.id,
      // Typed text replaces the selection, as in the desktop dialog.
      answers: custom.length > 0 ? [custom] : selections,
      questions,
      harness: decision.harness,
      toolUseId,
    };
    const request = buildPendingAnswerRequest(target);
    if ('error' in request) {
      onError(toolUseId, request.error);
      return;
    }
    onError(toolUseId, undefined);
    setSending(true);
    markAnswered(toolUseId);
    try {
      await postPendingAnswer(request, 'Failed to deliver answer');
    } catch (err) {
      onError(toolUseId, err instanceof Error ? err.message : String(err));
      setSending(false);
      unmarkAnswered(toolUseId);
    }
  };

  return (
    <div className="space-y-4 px-4 pb-4">
      {questions.map((q, qIdx) => (
        <fieldset key={`q-${qIdx}`} className="space-y-2">
          {q.header ? <legend className="text-xs text-muted-foreground">{q.header}</legend> : null}
          <p className="text-sm font-medium text-foreground">{q.question}</p>
          {q.context ? (
            <p className="whitespace-pre-line text-sm text-muted-foreground">{q.context}</p>
          ) : null}
          {q.options.map((opt, oIdx) => {
            const selected = custom.length === 0 && selections[qIdx] === opt.label;
            return (
              <button
                key={`q-${qIdx}-opt-${oIdx}`}
                type="button"
                aria-pressed={selected}
                disabled={sending}
                onClick={() => {
                  setSelections((prev) => prev.map((s, i) => (i === qIdx ? opt.label : s)));
                  setCustomText('');
                }}
                className={`block min-h-11 w-full rounded-sm border px-3 py-2 text-left text-sm disabled:opacity-60 ${
                  selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-foreground'
                }`}
              >
                <span className="font-medium">{opt.label}</span>
                {opt.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{opt.description}</span> : null}
              </button>
            );
          })}
        </fieldset>
      ))}
      {!isCodexApproval && (
        typing ? (
          <textarea
            aria-label="Your answer"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            disabled={sending}
            rows={3}
            placeholder="Typed text is sent instead of the selected options."
            className="w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        ) : (
          <button
            type="button"
            onClick={() => setTyping(true)}
            className="min-h-11 min-w-11 text-sm text-muted-foreground underline"
          >
            Type an answer
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => void send()}
        disabled={!canSend}
        className="min-h-11 w-full rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function ReadOnlyAction({ decision }: { decision: Decision }) {
  // PAN-4941 — a secret request is answered only on this machine's own desktop dashboard.
  if (decision.agentRequest) return <p className="px-4 pb-3 text-xs text-muted-foreground">Answer on the desktop</p>;
  if (decision.source === 'conversation') {
    return (
      <div className="px-4 pb-3">
        <button
          type="button"
          onClick={() => openConversation(decision.id)}
          className="min-h-11 min-w-11 rounded-sm border border-border px-4 text-sm font-medium text-foreground"
        >
          Open
        </button>
      </div>
    );
  }
  return <p className="px-4 pb-3 text-xs text-muted-foreground">Answer on the desktop</p>;
}

export function MobileNeedsYou({ subjectId }: { subjectId: string | null }) {
  const decisions = useDecisions();
  const answeredToolUseIds = useAskUserQuestionUiStore((s) => s.answeredToolUseIds);
  // undefined: follow the default (subject or first question); null: the operator collapsed every card.
  const [expandedId, setExpandedId] = useState<string | null | undefined>(undefined);
  const expandedRef = useRef<HTMLLIElement | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setError = useCallback((toolUseId: string, message: string | undefined) => {
    setErrors((prev) => {
      if (prev[toolUseId] === message) return prev;
      const next = { ...prev };
      if (message === undefined) delete next[toolUseId];
      else next[toolUseId] = message;
      return next;
    });
  }, []);

  const rows = decisions.filter((d) => {
    const toolUseId = d.pendingAskUserQuestion?.toolUseId;
    return !(toolUseId && answeredToolUseIds.has(toolUseId));
  });
  const subjectRow = subjectId === null ? undefined : rows.find((d) => d.id === subjectId);
  const subjectGone = subjectId !== null && subjectRow === undefined;
  const chosen = expandedId ? rows.find((d) => d.id === expandedId) : undefined;
  const openId = expandedId === null ? null : chosen?.id
    ?? (subjectRow && answerableQuestion(subjectRow) ? subjectRow.id : undefined)
    ?? rows.find((d) => answerableQuestion(d) !== null)?.id
    ?? null;

  useEffect(() => {
    // Scroll the list's own container: scrollIntoView also pans the page on a phone.
    const row = expandedRef.current;
    const scroller = row?.closest('main');
    if (!subjectRow || !row || !scroller) return;
    scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }, [subjectRow]);

  const now = new Date();
  return (
    <section aria-label="Needs you">
      {subjectGone ? (
        <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">This question was already answered.</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nothing needs you.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((decision) => {
            const pending = answerableQuestion(decision);
            const open = pending !== null && decision.id === openId;
            return (
              <li
                key={decision.id}
                ref={decision.id === subjectRow?.id ? expandedRef : undefined}
                data-subject-id={decision.id}
                data-expanded={open ? 'true' : 'false'}
              >
                <button
                  type="button"
                  aria-expanded={pending ? open : undefined}
                  onClick={() => pending && setExpandedId(open ? null : decision.id)}
                  className="flex min-h-11 w-full items-start justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {decision.issueId && decision.issueId !== decision.label ? `${decision.issueId} · ${decision.label}` : decision.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {describePendingInput(decision.kinds, decision.turnEndAssessment)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(decision.since, now)}</span>
                </button>
                {pending ? (open ? <QuestionCard key={pending.toolUseId} decision={decision} pending={pending} error={errors[pending.toolUseId]} onError={setError} /> : null) : <ReadOnlyAction decision={decision} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
