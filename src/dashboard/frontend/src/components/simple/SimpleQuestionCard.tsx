/**
 * PAN-3090 — rich question card for the simple issue page.
 *
 * When the blocked agent's pending question payload is exactly one
 * single-select question, the page shows the question itself — quoted, with
 * its options as selectable rows and the answer composer inside the card —
 * instead of the generic "needs one decision" sentence. Any other payload
 * shape (multiple questions, multi-select, none structured) renders nothing
 * here and the page keeps the generic card + composer path (the Advanced
 * dialog remains the answer path for those).
 *
 * Copy comes from SIMPLE_STRINGS (copy-lint enforced).
 */
import { useState } from 'react';
import { CircleHelp, LoaderCircle } from 'lucide-react';
import type { AgentSnapshot } from '@overdeck/contracts';
import { SIMPLE_STRINGS } from '../../lib/simple/strings';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { PrimaryButton } from './parts';
import { cn } from '../../lib/utils';

const S = SIMPLE_STRINGS.issue;

/** The exact payload shape this card answers: one question, single-select. */
export function isRichQuestion(agent: AgentSnapshot): boolean {
  const questions = agent.pendingAskUserQuestion?.questions;
  return Array.isArray(questions) && questions.length === 1 && questions[0]!.multiSelect !== true;
}

interface SimpleQuestionCardProps {
  agent: AgentSnapshot;
  onSend: (text: string, onSuccess: () => void) => void;
  sending: boolean;
}

export function SimpleQuestionCard({ agent, onSend, sending }: SimpleQuestionCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [sent, setSent] = useState(false);

  // Self-guard: any payload this card can't answer renders nothing, and the
  // page keeps the generic card + composer path.
  if (!isRichQuestion(agent)) return null;
  const pending = agent.pendingAskUserQuestion!;
  const question = pending.questions[0]!;

  if (sent) {
    return (
      <div className="mt-4 rounded-2xl border-l-[3px] border-info bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_4px_16px_rgb(0_0_0/0.05)] dark:border dark:border-border">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-info/10 text-info-foreground">
            <LoaderCircle size={15} />
          </span>
          <div>
            <div className="text-[15px] font-medium">{S.answerSentTitle}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{S.answerSentSub}</div>
          </div>
        </div>
      </div>
    );
  }

  const send = () => {
    const text = typed.trim() || selected;
    if (!text || sending) return;
    onSend(text, () => setSent(true));
  };

  return (
    <div className="mt-4 rounded-2xl border-l-[3px] border-warning bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.05),0_4px_16px_rgb(0_0_0/0.05)] dark:border dark:border-border">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-warning/10 text-warning-foreground">
          <CircleHelp size={15} />
        </span>
        <div>
          <div className="text-[15px] font-medium">{S.questionTitle}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {S.questionAskedPrefix}{formatRelativeTime(pending.askedAt, new Date())} · {S.questionPauseSuffix}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-[10px] bg-accent px-3.5 py-3 text-[14px] leading-relaxed">
        {question.question}
      </div>

      {question.options.length > 0 && (
        <div className="mt-2.5 grid gap-2">
          {question.options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setSelected(opt.label)}
              className={cn(
                'flex items-start gap-2.5 rounded-[10px] border border-input px-3 py-2.5 text-left text-[13.5px]',
                selected === opt.label && 'border-ring shadow-[0_0_0_1px] shadow-ring',
              )}
            >
              <span
                className={cn(
                  'mt-[3px] h-3.5 w-3.5 flex-none rounded-full border-2 border-muted-foreground',
                  selected === opt.label && 'border-primary bg-primary shadow-[inset_0_0_0_2.5px] shadow-card',
                )}
              />
              <span>
                <span className="block font-medium">{opt.label}</span>
                {opt.description && <span className="block text-[12.5px] text-muted-foreground">{opt.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder={S.questionAnswerPlaceholder}
          className="h-[38px] flex-1 rounded-[10px] border border-input bg-transparent px-3 text-[13.5px] outline-none focus:border-ring"
        />
        <PrimaryButton disabled={sending || (!typed.trim() && !selected)} onClick={send}>
          {S.answerSend}
        </PrimaryButton>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">{S.questionOptionsHint}</div>
    </div>
  );
}
