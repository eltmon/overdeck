import type { GitHubQuotaCallerUsage, GitHubQuotaSnapshot } from '@overdeck/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { selectGitHubQuota, useDashboardStore } from '../lib/store';

const POPOVER_ID = 'github-quota-popover';
const POPOVER_TITLE_ID = 'github-quota-popover-title';
const TOP_CALLERS = 5;

function totalPoints(usage: GitHubQuotaCallerUsage): number {
  return usage.graphql.points + usage.rest.points;
}

/** The top callers by GraphQL + REST points in the last hour, highest first. */
export function topGitHubQuotaCallers(quota: GitHubQuotaSnapshot): GitHubQuotaCallerUsage[] {
  return [...quota.callers]
    .filter((usage) => totalPoints(usage) > 0)
    .sort((a, b) => totalPoints(b) - totalPoints(a))
    .slice(0, TOP_CALLERS);
}

/** The top-callers list and the unattributed row, shared by the pill popover and the section. */
function QuotaCallers({ quota }: { quota: GitHubQuotaSnapshot }) {
  const callers = topGitHubQuotaCallers(quota);
  return (
    <>
      {callers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metered GitHub calls this hour.</p>
      ) : (
        <ul className="space-y-1" data-testid="github-quota-callers">
          {callers.map((usage) => (
            <li key={usage.caller} className="flex items-center justify-between gap-3 text-xs">
              <span className="font-mono text-foreground">{usage.caller}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {totalPoints(usage)} pts{usage.estimated ? ' (est.)' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2 text-xs text-muted-foreground">
        <span>Unattributed (other tools and installs)</span>
        <span className="font-mono tabular-nums">{quota.unattributed} pts</span>
      </div>
    </>
  );
}

/**
 * GitHubQuotaSection (PAN-5292 WI-E4, E-D12) — the GitHub quota block inside
 * the top bar's health-dot popover. It shows the user account's GraphQL budget
 * from the latest `rateLimit` sample, then the five callers that spent the most
 * points this hour and the points no metered caller claims. The label turns
 * amber while GitHub calls are paused. Renders nothing until the server's
 * publisher first reports, so the popover shows no empty heading.
 */
export function GitHubQuotaSection() {
  const quota = useDashboardStore(selectGitHubQuota);
  if (!quota) return null;

  const sample = quota.samples.find((s) => s.pool === 'user' && s.bucket === 'graphql');
  const paused = quota.pauses.length > 0;

  return (
    <section aria-label="GitHub quota" data-testid="github-quota-section" className="mt-3 border-t border-border pt-3">
      <div className="eyebrow mb-2">GitHub quota</div>
      <p
        data-testid="github-quota-label"
        className={`mb-2 text-xs tabular-nums ${paused ? 'text-warning-foreground' : 'text-foreground'}`}
      >
        {sample ? `${sample.remaining} of ${sample.limit} GraphQL points left this hour` : 'No sample yet'}
      </p>
      <QuotaCallers quota={quota} />
    </section>
  );
}

/**
 * GitHubQuotaPill (PAN-4264) — the user account's GitHub GraphQL budget
 * (`GH <remaining>/<limit>` from the latest GraphQL `rateLimit` sample, not
 * REST `/rate_limit` — PAN-4291 found the REST bucket badly under-reports
 * it — `GH —` before the first sample). The popover lists the five callers
 * that spent the most points this hour plus the points no metered caller
 * claims.
 *
 * Neutral at rest; amber while GitHub calls are paused (the operator should
 * know). Never green: a healthy budget is the rest state, not an outcome.
 * Hidden until the server's publisher first reports (always on a peer).
 */
export function GitHubQuotaPill() {
  const quota = useDashboardStore(selectGitHubQuota);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  if (!quota) return null;

  const sample = quota.samples.find((s) => s.pool === 'user' && s.bucket === 'graphql');
  const label = sample ? `GH ${sample.remaining}/${sample.limit}` : 'GH —';
  const paused = quota.pauses.length > 0;
  const tone = paused
    ? 'border-warning/40 bg-warning/10 text-warning-foreground'
    : 'border-border text-muted-foreground';
  const description = sample
    ? `GitHub GraphQL quota${quota.login ? ` for ${quota.login}` : ''}: ${sample.remaining} of ${sample.limit} points left this hour`
    : 'GitHub GraphQL quota: no sample yet';

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center rounded-md border px-2 py-1.5 font-mono text-xs tabular-nums transition-colors hover:bg-accent ${tone}`}
        data-testid="github-quota-pill"
        title={description}
        aria-label={description}
        aria-expanded={open}
        aria-controls={POPOVER_ID}
        aria-haspopup="dialog"
      >
        {label}
      </button>

      {open && (
        <div
          id={POPOVER_ID}
          role="dialog"
          aria-labelledby={POPOVER_TITLE_ID}
          className="absolute right-0 top-full z-[200] mt-2 w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-border bg-popover p-3 text-sm shadow-lg"
        >
          <p id={POPOVER_TITLE_ID} className="mb-2 font-medium text-foreground">GitHub calls, last hour</p>
          <QuotaCallers quota={quota} />
        </div>
      )}
    </div>
  );
}
