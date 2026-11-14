import { Check, Loader2, Minus, X } from 'lucide-react';
import { statusColor } from '../CommandDeck/ZoneCOverviewTabs/PrDiffTab';
import { useIssueCheckRunsQuery, type IssueCheckRun } from '../CommandDeck/ZoneCOverviewTabs/queries';

function checkRunStateText(run: Pick<IssueCheckRun, 'status' | 'conclusion'>): string {
  const text = run.status !== 'completed' ? run.status : (run.conclusion ?? 'unknown');
  return text.replace(/_/g, ' ');
}

function CheckRowIcon({ label }: { label: string }) {
  if (label === 'pass') return <Check className="h-[14px] w-[14px] shrink-0 text-success-foreground" />;
  if (label === 'fail') return <X className="h-[14px] w-[14px] shrink-0 text-destructive-foreground" />;
  if (label === 'skip') return <Minus className="h-[14px] w-[14px] shrink-0 text-muted-foreground" />;
  return <Loader2 className="h-[14px] w-[14px] shrink-0 animate-spin text-info-foreground motion-reduce:animate-none" />;
}

/** statusColor falls back to `status` when there is no conclusion; for a
 * completed run that reads "COMPLETED" as a pass, so a run with no
 * conclusion at all would show a success checkmark next to the "unknown"
 * text checkRunStateText renders for the same run. Only a conclusion can
 * establish success. */
function checkRunLabel(run: Pick<IssueCheckRun, 'status' | 'conclusion'>): string {
  if (run.status === 'completed' && !run.conclusion) return 'skip';
  return statusColor({ status: run.status, conclusion: run.conclusion ?? undefined }).label;
}

function CheckRow({ run }: { run: IssueCheckRun }) {
  const label = checkRunLabel(run);
  const href = run.htmlUrl ?? run.detailsUrl;
  const content = (
    <>
      <CheckRowIcon label={label} />
      <span className="min-w-0 flex-1 truncate">{run.name}</span>
      <span className="font-mono-ui text-[11.5px] text-muted-foreground">{checkRunStateText(run)}</span>
    </>
  );
  const className = 'list-row flex items-center gap-[10px] border-t border-border py-[7px] text-[13px]';
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className} data-check-state={label}>
      {content}
    </a>
  ) : (
    <div className={className} data-check-state={label}>
      {content}
    </div>
  );
}

export function IssueChecksPanel({ issueId }: { issueId: string }) {
  const checks = useIssueCheckRunsQuery(issueId);
  const data = checks.data;
  const summary = data?.summary;
  const runs = data?.checkRuns ?? [];
  return (
    <section data-testid="issue-checks-panel" aria-label="Checks">
      <h3 className="mb-[8px] text-[13px] font-semibold text-foreground">
        {checks.isLoading ? 'Loading checks'
          : checks.isError ? 'Could not load checks'
          : !data?.pr ? 'No pull request yet'
          : summary?.total ? <>{summary.passed} of {summary.total} checks passed on <a href={data.pr.url} target="_blank" rel="noreferrer" className="font-mono-ui text-primary-ink hover:underline">#{data.pr.number}</a></>
          : 'No check runs reported'}
      </h3>
      {data?.error ? <p className="mb-[8px] rounded-[var(--radius)] border px-[10px] py-[6px] text-[12px] badge-border-destructive badge-bg-destructive text-destructive-foreground">{data.error}</p> : null}
      {runs.map((run) => <CheckRow key={run.id || run.name} run={run} />)}
      {summary && summary.total > 0 ? (
        <p className="mt-[8px] text-[12px] text-muted-foreground">{summary.failed} failed · {summary.running} running · {summary.pending} pending · {summary.skipped} skipped</p>
      ) : null}
    </section>
  );
}
