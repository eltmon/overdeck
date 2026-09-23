/**
 * Issue context for an Agents Directory entry (PAN-3920 W7, D10): the
 * derived issue state, its PR and branch, and the issue's primary actions.
 * The checks word is the block's single colored signal.
 */
import type { ReactNode } from 'react';
import type { PrChecksState } from '@overdeck/contracts';

import { useDashboardStore, useDerivedIssueState } from '../../../lib/store';
import { cn } from '../../../lib/utils';
import { IssueActionMenu } from '../../IssueActionMenu';

const CHECKS_CLASS: Record<PrChecksState, string> = {
  green: 'text-success',
  red: 'text-destructive',
  pending: 'text-info',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="w-20 shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-[12px] text-foreground">{children}</dd>
    </div>
  );
}

export function DirectoryIssueContext({ issueId }: { issueId: string }) {
  const derived = useDerivedIssueState(issueId);
  const openIssue = useDashboardStore((state) => state.openIssue);

  return (
    <section aria-label={`Issue ${issueId}`} data-component="directory-issue-context" className="border-b border-border px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono-ui text-[12px] text-foreground">{issueId}</span>
        {derived && <span className="text-[12px] text-muted-foreground">{derived.state}</span>}
        <button
          type="button"
          onClick={() => openIssue(issueId, 'overview')}
          className="ml-auto text-[12px] text-muted-foreground hover:text-foreground"
        >
          Open issue
        </button>
      </div>
      {derived ? (
        <dl className="grid grid-cols-1 gap-1 @[520px]/detail:grid-cols-2">
          {derived.pr ? (
            <>
              <Field label="PR">
                <a href={derived.pr.url} target="_blank" rel="noreferrer" className="font-mono-ui hover:underline">
                  #{derived.pr.number}
                </a>
              </Field>
              <Field label="Review">{derived.pr.reviewState}</Field>
              <Field label="Checks">
                <span className={cn(CHECKS_CLASS[derived.pr.checks])} data-component="directory-checks">{derived.pr.checks}</span>
              </Field>
              <Field label="Mergeable">
                {derived.pr.mergeable === null ? 'not computed' : derived.pr.mergeable ? 'yes' : 'no'}
              </Field>
            </>
          ) : (
            <Field label="PR">none</Field>
          )}
          {derived.branch && (
            <>
              <Field label="Branch"><span className="font-mono-ui">{derived.branch.name}</span></Field>
              <Field label="Ahead">
                <span className="tabular-nums">{derived.branch.aheadOfMain}</span>
                {derived.branch.pushed ? ' · pushed' : ' · not pushed'}
              </Field>
            </>
          )}
        </dl>
      ) : (
        <p className="text-[12px] text-muted-foreground">Issue state is loading or unavailable.</p>
      )}
      <div className="mt-3">
        <IssueActionMenu issueId={issueId} mode="primary-strip" />
      </div>
    </section>
  );
}
