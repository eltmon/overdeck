import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useReviewStatusQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { useIssueActions, type IssueActionView } from '../../IssueActionMenu/useIssueActions'
import { deriveSpotlight } from './spotlight'

/**
 * IssueBlockerSpotlight — the band's hero banner. When the issue is blocked
 * (review/test/verify/merge) it surfaces the *reason* and the unblock actions
 * at the very top of the cockpit; when it's ready to merge it says so in green.
 * Renders nothing when there's nothing to surface. Action buttons are wired to
 * the real IssueActionMenu registry (no fake buttons) and only shown when the
 * action is currently enabled. (Command Deck remodel S3.)
 */
export function IssueBlockerSpotlight({ issueId }: { issueId: string }) {
  const reviewStatus = useReviewStatusQuery(issueId)
  const actions = useIssueActions(issueId)
  const [expanded, setExpanded] = useState(false)

  const spotlight = deriveSpotlight(reviewStatus.data)
  if (!spotlight) return null

  const blocked = spotlight.tone === 'blocked'
  const buttons = spotlight.actionKeys
    .map((key) => actions.all.find((v) => v.action.key === key))
    .filter((v): v is IssueActionView => !!v && v.enabled)
    .slice(0, 3)

  const cycle = reviewStatus.data?.verificationCycleCount
  const maxCycle = reviewStatus.data?.verificationMaxCycles
  const detail = spotlight.detail?.trim()
  const longDetail = (detail?.length ?? 0) > 160
  const shownDetail = detail && longDetail && !expanded ? `${detail.slice(0, 160)}…` : detail

  return (
    <div
      className={`mt-3.5 flex items-start gap-3 rounded-[14px] border px-3.5 py-3 ${
        blocked
          ? 'badge-border-destructive badge-bg-destructive'
          : 'badge-border-success badge-bg-success'
      }`}
    >
      <div className={`mt-0.5 shrink-0 ${blocked ? 'text-destructive-foreground' : 'text-success-foreground'}`}>
        {blocked ? <AlertTriangle className="h-[18px] w-[18px]" /> : <CheckCircle2 className="h-[18px] w-[18px]" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className={`text-[12.5px] font-semibold ${blocked ? 'text-destructive-foreground' : 'text-success-foreground'}`}>
          {spotlight.title}
        </div>
        {detail && (
          <div className="mt-0.5 text-[12px] leading-snug text-foreground/85">
            {shownDetail}
            {longDetail && (
              <button
                type="button"
                className="ml-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? 'less' : 'more'}
              </button>
            )}
          </div>
        )}
        {buttons.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {buttons.map((view, i) => (
              <button
                key={view.action.key}
                type="button"
                disabled={view.isPending}
                onClick={view.invoke}
                className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
                  i === 0 && blocked
                    ? 'badge-border-destructive text-destructive-foreground hover:bg-destructive/10'
                    : 'border-border text-foreground hover:bg-accent'
                }`}
              >
                {view.action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {typeof cycle === 'number' && (
        <span className="shrink-0 rounded-[var(--radius-sm)] border border-border bg-muted px-[7px] py-[2px] text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          cycle {cycle}{maxCycle ? `/${maxCycle}` : ''}
        </span>
      )}
    </div>
  )
}
