/**
 * PrDiffTab — pull-request and diff view for the issue-selected Command Deck.
 *
 * Pulls from `/api/issues/:issueId/pr` (gh pr view + gh pr diff). Renders:
 *   - Header: PR number, title, state badge, draft pill, branches, age
 *   - CI rollup row: per-check status (success / failure / pending)
 *   - Reviewers row: requested + decision
 *   - File changes list with +adds / −dels and small width bars
 *   - Diff body styled as a colored unified patch
 *
 * Empty case: "No PR yet for feature/<id>". Error case: surface gh error inline.
 *
 * Backend lands in pan-9yn5 (this bead). Polls every 30s — same cadence as costs.
 */

import { useMemo } from 'react';
import { usePrQuery, type PullRequestData } from './queries';

interface PrDiffTabProps {
  issueId: string;
}

function statusColor(check: { state?: string; conclusion?: string; status?: string }): {
  bg: string;
  fg: string;
  label: string;
} {
  const verdict = (check.conclusion || check.state || check.status || '').toUpperCase();
  if (verdict === 'SUCCESS' || verdict === 'COMPLETED') {
    return { bg: 'color-mix(in srgb, var(--success, #10b981) 18%, transparent)', fg: 'var(--success, #10b981)', label: 'pass' };
  }
  if (verdict === 'FAILURE' || verdict === 'CANCELLED' || verdict === 'TIMED_OUT' || verdict === 'ACTION_REQUIRED' || verdict === 'STARTUP_FAILURE') {
    return { bg: 'color-mix(in srgb, var(--destructive) 18%, transparent)', fg: 'var(--destructive)', label: 'fail' };
  }
  if (verdict === 'PENDING' || verdict === 'IN_PROGRESS' || verdict === 'QUEUED' || verdict === 'WAITING') {
    return { bg: 'color-mix(in srgb, var(--primary) 18%, transparent)', fg: 'var(--primary)', label: 'run' };
  }
  if (verdict === 'NEUTRAL' || verdict === 'SKIPPED' || verdict === 'STALE') {
    return { bg: 'color-mix(in srgb, var(--muted-foreground) 18%, transparent)', fg: 'var(--muted-foreground)', label: 'skip' };
  }
  return { bg: 'var(--muted)', fg: 'var(--muted-foreground)', label: verdict.toLowerCase() || 'unknown' };
}

function diffLineColor(line: string): string | undefined {
  if (line.startsWith('+++ ') || line.startsWith('--- ')) return 'var(--mc-text-muted, var(--muted-foreground))';
  if (line.startsWith('+')) return 'var(--success, #10b981)';
  if (line.startsWith('-')) return 'var(--destructive)';
  if (line.startsWith('@@')) return 'var(--primary)';
  if (line.startsWith('diff ')) return 'var(--foreground)';
  return undefined;
}

function StateBadge({ pr }: { pr: PullRequestData }) {
  const stateUpper = pr.state.toUpperCase();
  let bg = 'var(--muted)';
  let fg = 'var(--muted-foreground)';
  let label: string = pr.state;
  if (stateUpper === 'OPEN') {
    bg = pr.isDraft
      ? 'color-mix(in srgb, var(--muted-foreground) 18%, transparent)'
      : 'color-mix(in srgb, var(--success, #10b981) 18%, transparent)';
    fg = pr.isDraft ? 'var(--muted-foreground)' : 'var(--success, #10b981)';
    label = pr.isDraft ? 'draft' : 'open';
  } else if (stateUpper === 'MERGED') {
    bg = 'color-mix(in srgb, #a855f7 18%, transparent)';
    fg = '#a855f7';
    label = 'merged';
  } else if (stateUpper === 'CLOSED') {
    bg = 'color-mix(in srgb, var(--destructive) 18%, transparent)';
    fg = 'var(--destructive)';
    label = 'closed';
  }
  return (
    <span
      data-testid="pr-state-badge"
      style={{
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        padding: '2px 8px',
        borderRadius: 999,
      }}
    >
      {label}
    </span>
  );
}

export function PrDiffTab({ issueId }: PrDiffTabProps) {
  const { data, isLoading, isError } = usePrQuery(issueId);

  const fileMax = useMemo(() => {
    if (!data?.pr?.files) return 1;
    return Math.max(1, ...data.pr.files.map((f) => f.additions + f.deletions));
  }, [data]);

  if (isLoading) {
    return (
      <div
        data-testid="prdiff-tab-loading"
        style={{ padding: 16, fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
      >
        Loading pull request…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div data-testid="prdiff-tab-error" style={{ padding: 16, fontSize: 12, color: 'var(--destructive)' }}>
        Failed to load pull request.
      </div>
    );
  }

  if (!data.pr) {
    return (
      <div
        data-testid="prdiff-tab-empty"
        style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>No pull request yet</div>
        <div style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
          No PR found for branch <code>feature/{issueId.toLowerCase()}</code>.
          {data.error ? (
            <>
              {' '}
              <span data-testid="prdiff-tab-error-msg" style={{ color: 'var(--destructive)' }}>
                ({data.error})
              </span>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  const pr = data.pr;
  const checks = pr.statusCheckRollup ?? [];
  const reviewers = pr.reviewRequests ?? [];

  return (
    <div
      data-testid="prdiff-tab"
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}
    >
      <header
        data-testid="prdiff-tab-header"
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            data-testid="prdiff-tab-link"
            style={{ fontSize: 16, fontWeight: 700, color: 'var(--foreground)', textDecoration: 'none' }}
          >
            #{pr.number} {pr.title}
          </a>
          <StateBadge pr={pr} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
          <code>{pr.headRefName}</code> → <code>{pr.baseRefName}</code>
          {pr.author?.login ? <> · @{pr.author.login}</> : null}
          {' · '}
          <span data-testid="prdiff-tab-changes">
            +{pr.additions} −{pr.deletions} across {pr.changedFiles}{' '}
            file{pr.changedFiles === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      <section
        data-testid="prdiff-tab-checks"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--mc-border, var(--border))',
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <header
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--mc-text-muted, var(--muted-foreground))',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          CI checks
          {pr.reviewDecision ? (
            <span
              data-testid="prdiff-tab-review-decision"
              style={{ marginLeft: 8, color: 'var(--foreground)', textTransform: 'none', fontWeight: 500 }}
            >
              · review: {pr.reviewDecision.toLowerCase().replace(/_/g, ' ')}
            </span>
          ) : null}
        </header>
        {checks.length === 0 ? (
          <div
            data-testid="prdiff-tab-checks-empty"
            style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
          >
            No checks reported.
          </div>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
            }}
          >
            {checks.map((check, idx) => {
              const c = statusColor(check);
              const name = check.name || check.workflowName || check.__typename || `check-${idx}`;
              return (
                <li
                  key={`${name}-${idx}`}
                  data-testid={`prdiff-check-${name}`}
                  style={{
                    background: c.bg,
                    color: c.fg,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: 4 }}>
                    {c.label}
                  </span>
                  <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {reviewers.length > 0 && (
        <section
          data-testid="prdiff-tab-reviewers"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--mc-border, var(--border))',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <header
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--mc-text-muted, var(--muted-foreground))',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Reviewers requested
          </header>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {reviewers.map((r, idx) => (
              <span
                key={`${r.login || r.name || idx}`}
                data-testid={`prdiff-reviewer-${r.login || r.name || idx}`}
                style={{
                  background: 'var(--accent)',
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                }}
              >
                @{r.login || r.name || 'reviewer'}
              </span>
            ))}
          </div>
        </section>
      )}

      <section
        data-testid="prdiff-tab-files"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--mc-border, var(--border))',
          borderRadius: 8,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <header
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--mc-text-muted, var(--muted-foreground))',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Files ({pr.files.length})
        </header>
        {pr.files.length === 0 ? (
          <div
            data-testid="prdiff-tab-files-empty"
            style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
          >
            No file metadata returned.
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {pr.files.map((f) => {
              const total = f.additions + f.deletions;
              const addPct = total === 0 ? 0 : (f.additions / fileMax) * 100;
              const delPct = total === 0 ? 0 : (f.deletions / fileMax) * 100;
              return (
                <li
                  key={f.path}
                  data-testid={`prdiff-file-${f.path}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                >
                  <span style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.path}
                  </span>
                  <span
                    style={{
                      flex: '0 0 90px',
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: 'var(--success, #10b981)' }}>+{f.additions}</span>{' '}
                    <span style={{ color: 'var(--destructive)' }}>−{f.deletions}</span>
                  </span>
                  <div
                    style={{
                      flex: '0 0 80px',
                      height: 6,
                      background: 'var(--accent)',
                      borderRadius: 3,
                      overflow: 'hidden',
                      display: 'flex',
                    }}
                  >
                    <div style={{ width: `${addPct}%`, height: '100%', background: 'var(--success, #10b981)' }} />
                    <div style={{ width: `${delPct}%`, height: '100%', background: 'var(--destructive)' }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data.diff && (
        <section
          data-testid="prdiff-tab-diff"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--mc-border, var(--border))',
            borderRadius: 8,
            padding: 0,
            overflow: 'hidden',
          }}
        >
          <header
            style={{
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--mc-text-muted, var(--muted-foreground))',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              borderBottom: '1px solid var(--mc-border, var(--border))',
            }}
          >
            Patch
          </header>
          <pre
            data-testid="prdiff-tab-diff-body"
            style={{
              margin: 0,
              padding: 12,
              fontSize: 11,
              fontFamily: 'var(--font-mono, monospace)',
              lineHeight: 1.5,
              whiteSpace: 'pre',
              overflowX: 'auto',
              maxHeight: 480,
            }}
          >
            {data.diff.split('\n').map((line, idx) => {
              const color = diffLineColor(line);
              return (
                <div key={idx} style={color ? { color } : undefined}>
                  {line || '\u00A0'}
                </div>
              );
            })}
          </pre>
        </section>
      )}
    </div>
  );
}
