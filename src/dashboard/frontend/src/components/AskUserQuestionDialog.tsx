/**
 * PAN-1520 — AskUserQuestion interactive dialog.
 *
 * Renders the pending question's option list as clickable buttons so the
 * operator can answer with one click instead of typing. Mirrors the
 * `ChannelPermissionDialog` pattern (same modal chrome, same submit-while-
 * disabled UX).
 *
 * Why this exists: upstream Claude Code does not render the AskUserQuestion
 * choice menu under `--dangerously-skip-permissions`. Our `ask-user-question-
 * hook` (PreToolUse, PAN-1520 Phase 1) denies the tool call to prevent the
 * silent fabrication of option #1 as the answer. By the time this dialog
 * shows, the agent has restated the question as plain text and is waiting on
 * a normal user message. The dialog delivers that message via the standard
 * `deliverAgentMessage` pipeline.
 */
import { useState } from 'react'
import { Loader2, MessageCircleQuestion } from 'lucide-react'
import type { AgentSnapshot } from '@panctl/contracts'

interface AskUserQuestionDialogProps {
  agent: AgentSnapshot | null
  isOpen: boolean
  issueId?: string
  isSubmitting?: boolean
  onSubmit: (answers: string[]) => void
  onDismiss: () => void
}

export function AskUserQuestionDialog({
  agent,
  isOpen,
  issueId,
  isSubmitting = false,
  onSubmit,
  onDismiss,
}: AskUserQuestionDialogProps) {
  const pending = agent?.pendingAskUserQuestion
  const questions = pending?.questions ?? []
  // One selected label per question, initialized empty so we can validate.
  const [selections, setSelections] = useState<string[]>(() => questions.map(() => ''))
  const [customText, setCustomText] = useState('')

  if (!isOpen || !agent || !pending || questions.length === 0) return null

  const allSelected = selections.length === questions.length && selections.every((s) => s.length > 0)
  const canSubmit = allSelected || customText.trim().length > 0

  const handleSubmit = (): void => {
    if (customText.trim().length > 0) {
      onSubmit([customText.trim()])
    } else if (allSelected) {
      onSubmit(selections)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-primary/30 bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="rounded-full bg-primary/15 p-2">
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Agent Question</h2>
            <p className="text-sm text-muted-foreground">
              {agent.id} is waiting for an operator answer.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4 max-h-[60vh] overflow-y-auto">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent</p>
              <p className="font-mono text-sm text-foreground">{agent.id}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Issue</p>
              <p className="font-mono text-sm text-foreground">{issueId ?? agent.issueId ?? 'Unknown'}</p>
            </div>
          </div>

          {questions.map((q, qIdx) => (
            <div key={`q-${qIdx}`} className="space-y-2">
              {q.header ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{q.header}</p>
              ) : null}
              <p className="text-sm font-medium text-foreground">{q.question}</p>
              <div className="space-y-1">
                {q.options.map((opt, oIdx) => {
                  const isSelected = selections[qIdx] === opt.label
                  return (
                    <button
                      key={`q-${qIdx}-opt-${oIdx}`}
                      type="button"
                      onClick={() => {
                        setSelections((prev) => {
                          const next = [...prev]
                          next[qIdx] = opt.label
                          return next
                        })
                        setCustomText('')
                      }}
                      disabled={isSubmitting}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-background/40 text-foreground hover:bg-background/80'
                      }`}
                    >
                      <span className="font-medium">{opt.label}</span>
                      {opt.description ? (
                        <span className="ml-2 text-xs text-muted-foreground">{opt.description}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Or type a custom answer
            </p>
            <textarea
              value={customText}
              onChange={(e) => {
                setCustomText(e.target.value)
                if (e.target.value.length > 0) {
                  setSelections(questions.map(() => ''))
                }
              }}
              disabled={isSubmitting}
              rows={2}
              placeholder="Free-form prose response — submitted instead of any clicked option."
              className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-card/40 px-5 py-4">
          <button
            type="button"
            onClick={onDismiss}
            disabled={isSubmitting}
            className="rounded-md border border-border bg-popover px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !canSubmit}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Send Answer
          </button>
        </div>
      </div>
    </div>
  )
}
