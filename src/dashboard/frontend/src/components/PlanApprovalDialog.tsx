/**
 * PAN-1520 (FR-3) — plan-approval popup modal.
 *
 * When an agent or conversation session calls ExitPlanMode, the plan used to
 * be visible only inline in the terminal / transcript — an operator who wasn't
 * watching the terminal never knew a plan was waiting, and the session sat
 * blocked indefinitely (#1671, and the Drew incident 2026-07-13). This modal
 * promotes the pending plan the same way AskUserQuestionDialog promotes AUQs:
 * same chrome, same minimize-never-strands contract (the "Needs you" list
 * keeps it recoverable), and it never auto-approves (NFR-1).
 *
 * Approve / Request-Changes deliver native plan-menu keystrokes via
 * POST /api/agents/:id/plan-action (agents) or
 * POST /api/conversations/:name/plan-action (conversations).
 */
import { useState } from 'react'
import { ClipboardCheck, Loader2, Minus, Check, MessageSquare } from 'lucide-react'
import { ChatMarkdown } from './chat/ChatMarkdown'

export interface PlanApprovalSubject {
  id: string
  issueId?: string | null
  /** Display label — 'Agent' or 'Conversation'. Falls back to 'Subject'. */
  kindLabel?: string
  title?: string | null
  pendingProposedPlan?: {
    toolUseId: string
    askedAt: string
    plan: string
  } | null
}

interface PlanApprovalDialogProps {
  subject: PlanApprovalSubject | null
  isOpen: boolean
  isSubmitting?: boolean
  onApprove: () => void
  onRequestChanges: (feedback: string) => void
  onDismiss: () => void
}

export function PlanApprovalDialog({
  subject,
  isOpen,
  isSubmitting = false,
  onApprove,
  onRequestChanges,
  onDismiss,
}: PlanApprovalDialogProps) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const pending = subject?.pendingProposedPlan

  if (!isOpen || !subject || !pending) return null

  const displayName = subject.title?.trim() || subject.id

  const handleRequestChanges = (): void => {
    if (!feedback.trim()) return
    onRequestChanges(feedback.trim())
    setShowFeedback(false)
    setFeedback('')
  }

  return (
    // Clicking the backdrop minimizes (not approves) — the plan stays
    // recoverable via the "Needs you" list so navigation is never trapped.
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !isSubmitting) onDismiss() }}
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-primary/30 bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className="rounded-full bg-primary/15 p-2">
            <ClipboardCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-foreground">{displayName}</h2>
            <p className="text-sm text-muted-foreground">
              {subject.kindLabel ?? 'Agent'} finished planning and is waiting for your approval to start work.
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={isSubmitting}
            title="Minimize — keeps the plan in the activity feed's “Needs you” list"
            aria-label="Minimize"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 max-h-[65vh] overflow-y-auto">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{subject.kindLabel ?? 'Subject'}</p>
              <p className="font-mono text-sm text-foreground">{subject.id}</p>
              {subject.title ? (
                <p className="mt-1 text-sm font-medium text-foreground">{subject.title}</p>
              ) : null}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Issue</p>
              <p className="font-mono text-sm text-foreground">{subject.issueId ?? 'Unknown'}</p>
            </div>
          </div>

          <div className="rounded-md border border-border bg-background/40 px-4 py-3 text-sm">
            <ChatMarkdown text={pending.plan} cwd={undefined} />
          </div>

          {showFeedback && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What should change?
              </p>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                disabled={isSubmitting}
                rows={3}
                placeholder="Describe what to change — sent to the session as plan feedback."
                className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRequestChanges()
                }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border bg-card/40 px-5 py-4">
          <button
            type="button"
            onClick={onDismiss}
            disabled={isSubmitting}
            title="Keeps the plan in the activity feed's “Needs you” list — click it there to reopen"
            className="rounded-md border border-border bg-popover px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
          >
            Minimize
          </button>
          {showFeedback ? (
            <button
              type="button"
              onClick={handleRequestChanges}
              disabled={isSubmitting || !feedback.trim()}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-popover px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Feedback
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowFeedback(true)}
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-popover px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MessageSquare className="h-4 w-4" />
              Request Changes
            </button>
          )}
          <button
            type="button"
            onClick={onApprove}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve Plan
          </button>
        </div>
      </div>
    </div>
  )
}
