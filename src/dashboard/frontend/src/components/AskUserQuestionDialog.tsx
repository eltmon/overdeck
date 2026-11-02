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
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, MessageCircleQuestion, Minus } from 'lucide-react'
import { formatIssueRef } from '../lib/issueLabel'
import { ChatMarkdown } from './chat/ChatMarkdown'
import { bucketCount, capture } from '../lib/telemetry'

/**
 * PAN-1520 — minimal shape the dialog consumes. Works for either an
 * AgentSnapshot or a Conversation row; both surfaces carry the same
 * `pendingAskUserQuestion` field.
 */
export interface AskUserQuestionSubject {
  id: string
  /** Optional — agent.issueId or conv.issueId. Displayed in the header. */
  issueId?: string | null
  /** Tracker issue title resolved through the issues read door. */
  issueTitle?: string | null
  /** Display label — 'Agent' or 'Conversation'. Falls back to 'Subject'. */
  kindLabel?: string
  /** Optional human-readable title (e.g. conversation title) shown under the id. */
  title?: string | null
  pendingAskUserQuestion?: {
    toolUseId: string
    askedAt: string
    questions: ReadonlyArray<{
      question: string
      /** Supporting facts from `pan ask --context`, shown apart from the question. */
      context?: string
      header?: string
      multiSelect?: boolean
      options: ReadonlyArray<{ label: string; description?: string }>
    }>
  } | null
}

/** Elements the Tab trap cycles through inside the dialog panel. */
const FOCUSABLE_SELECTOR = 'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

interface AskUserQuestionDialogProps {
  subject: AskUserQuestionSubject | null
  isOpen: boolean
  isSubmitting?: boolean
  onSubmit: (answers: string[]) => void
  onDismiss: () => void
}

export function AskUserQuestionDialog({
  subject,
  isOpen,
  isSubmitting = false,
  onSubmit,
  onDismiss,
}: AskUserQuestionDialogProps) {
  const agent = subject
  const pending = agent?.pendingAskUserQuestion
  const questions = pending?.questions ?? []
  // PAN-1690 — Codex approval menus are answered by selecting a numbered
  // option (delivered as a keystroke), not free text, so the custom-answer box
  // is hidden for them.
  const isCodexApproval = pending?.toolUseId?.startsWith('codex-approval:') ?? false
  // One selected label per question, initialized empty so we can validate.
  const [selections, setSelections] = useState<string[]>(() => questions.map(() => ''))
  const [customText, setCustomText] = useState('')
  // App keeps this dialog mounted across questions, so reset the answer state
  // whenever a different question arrives. Stale selections from an earlier
  // multi-part question otherwise never match questions.length and Send stays
  // disabled.
  const questionKey = pending ? `${pending.toolUseId}:${pending.askedAt}` : ''
  const [answeredKey, setAnsweredKey] = useState(questionKey)
  if (answeredKey !== questionKey) {
    setAnsweredKey(questionKey)
    setSelections(questions.map(() => ''))
    setCustomText('')
  }

  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const isVisible = isOpen && !!agent && !!pending && questions.length > 0

  // PAN-4754 FR-8 — move focus into the dialog on open (the selected option,
  // else the first option) and hand it back to the opener on close. Keyed on
  // the question too, so a new question arriving while open refocuses.
  useEffect(() => {
    if (!isVisible) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const initial = panel?.querySelector<HTMLElement>('[data-dialog-option][data-selected="true"]')
      ?? panel?.querySelector<HTMLElement>('[data-dialog-option]')
    initial?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [isVisible, questionKey])

  if (!isVisible) return null

  const issueRef = formatIssueRef(agent.issueId, agent.issueTitle)
  const displayName = issueRef ?? (agent.title?.trim() || agent.id)
  const allSelected = selections.length === questions.length && selections.every((s) => s.length > 0)
  const canSubmit = allSelected || customText.trim().length > 0

  const handleSubmit = (): void => {
    const isCustom = customText.trim().length > 0
    capture('agent_question_answered', {
      subject_kind: agent.kindLabel === 'Conversation' ? 'conversation' : 'agent',
      answer_type: isCustom ? 'custom' : 'selection',
      question_count: bucketCount(questions.length),
    })
    if (isCustom) {
      onSubmit([customText.trim()])
    } else if (allSelected) {
      onSubmit(selections)
    }
  }

  // Tab and Shift+Tab wrap at the panel's last and first focusable elements.
  const handlePanelKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    // Clicking the backdrop minimizes (not answers) — the question stays
    // recoverable via the "Needs you" list so navigation is never trapped.
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onDismiss() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handlePanelKeyDown}
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-primary/30 bg-card shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="rounded-full bg-primary/15 p-2">
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-lg font-semibold text-foreground">{displayName}</h2>
            <p className="text-sm text-muted-foreground">
              {agent.kindLabel ?? 'Agent'} is waiting for an operator answer.
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={isSubmitting}
            title="Minimize — keeps the question in the activity feed's “Needs you” list"
            aria-label="Minimize"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 max-h-[60vh] overflow-y-auto">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{agent.kindLabel ?? 'Subject'}</p>
              <p className="font-mono text-sm text-foreground">{agent.id}</p>
              {agent.title ? (
                <p className="mt-1 text-sm font-medium text-foreground">{agent.title}</p>
              ) : null}
            </div>
            {issueRef ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Issue</p>
                <p className="font-mono text-sm text-foreground">{issueRef}</p>
              </div>
            ) : null}
          </div>

          {questions.map((q, qIdx) => (
            <div key={`q-${qIdx}`} className="space-y-2">
              {q.header ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{q.header}</p>
              ) : null}
              <div
                id={qIdx === 0 ? descriptionId : undefined}
                className="text-sm text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              >
                <ChatMarkdown text={q.question} cwd={undefined} />
              </div>
              <div className="space-y-1">
                {q.options.map((opt, oIdx) => {
                  const isSelected = selections[qIdx] === opt.label
                  return (
                    <button
                      key={`q-${qIdx}-opt-${oIdx}`}
                      type="button"
                      data-dialog-option=""
                      data-selected={isSelected ? 'true' : undefined}
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
              {q.context ? (
                <div className="space-y-1">
                  <p className="eyebrow">{"Agent's notes"}</p>
                  <div className="border-l-2 border-border pl-3 text-sm text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ChatMarkdown text={q.context} cwd={undefined} />
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          {!isCodexApproval && (
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
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-card/40 px-5 py-4">
          <button
            type="button"
            onClick={onDismiss}
            disabled={isSubmitting}
            title="Keeps the question in the activity feed's “Needs you” list — click it there to reopen"
            className="rounded-md border border-border bg-popover px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
          >
            Minimize
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
