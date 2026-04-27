/**
 * CostsTab — per-stage and per-model cost breakdown.
 *
 * Reuses the existing issue cost stream hook for live totals while keeping the
 * aggregate issue-cost endpoint for stage/model rollups.
 */

import { useIssueCostStream } from '../../../hooks/useCostStream';
import { useIssueCostsQuery, type IssueCostData } from './queries';

interface CostsTabProps {
  issueId: string;
}

interface BreakdownRow {
  label: string;
  cost: number;
  tokens: number;
}

function rowsFromMap(
  map: Record<string, { cost: number; tokens: number }> | undefined,
): BreakdownRow[] {
  if (!map) return [];
  return Object.entries(map)
    .map(([label, v]) => ({ label, cost: v.cost ?? 0, tokens: v.tokens ?? 0 }))
    .sort((a, b) => b.cost - a.cost);
}

function fmtCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}

function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

function BreakdownTable({
  testid,
  title,
  rows,
  total,
}: {
  testid: string;
  title: string;
  rows: BreakdownRow[];
  total: number;
}) {
  const max = Math.max(0.0001, ...rows.map((r) => r.cost));

  return (
    <section
      data-testid={testid}
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
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--mc-text-muted, var(--muted-foreground))',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        <span>{title}</span>
        <span data-testid={`${testid}-total`} style={{ color: 'var(--foreground)' }}>
          {fmtCost(total)}
        </span>
      </header>
      {rows.length === 0 ? (
        <div
          data-testid={`${testid}-empty`}
          style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
        >
          No data yet.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((row) => {
            const widthPct = (row.cost / max) * 100;
            return (
              <li
                key={row.label}
                data-testid={`${testid}-row-${row.label}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
              >
                <span style={{ flex: '0 0 120px', textTransform: 'capitalize' }}>{row.label}</span>
                <div
                  style={{
                    flex: 1,
                    height: 6,
                    background: 'var(--accent)',
                    borderRadius: 3,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${widthPct}%`,
                      height: '100%',
                      background: 'var(--primary)',
                      borderRadius: 3,
                    }}
                  />
                </div>
                <span
                  style={{
                    flex: '0 0 80px',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                  }}
                >
                  {fmtCost(row.cost)}
                </span>
                <span
                  style={{
                    flex: '0 0 60px',
                    textAlign: 'right',
                    fontSize: 11,
                    color: 'var(--mc-text-muted, var(--muted-foreground))',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtTokens(row.tokens)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CostsTab({ issueId }: CostsTabProps) {
  const stream = useIssueCostStream(issueId);
  const { data, isLoading, isError } = useIssueCostsQuery(issueId);

  if (isLoading || stream.isLoading) {
    return (
      <div
        data-testid="costs-tab-loading"
        style={{ padding: 16, fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
      >
        Loading costs…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        data-testid="costs-tab-error"
        style={{ padding: 16, fontSize: 12, color: 'var(--destructive)' }}
      >
        Failed to load costs.
      </div>
    );
  }

  const cost: IssueCostData = data;
  const stageRows = rowsFromMap(cost.byStage);
  const modelRows = rowsFromMap(cost.byModel);

  return (
    <div
      data-testid="costs-tab"
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }} data-testid="costs-total">
            {fmtCost(cost.totalCost)}
          </div>
          <div
            data-testid="costs-stream-total"
            style={{ fontSize: 11, color: 'var(--mc-text-muted, var(--muted-foreground))' }}
          >
            Live stream: {fmtCost(stream.issueCost)} · {stream.issueEvents.length} event
            {stream.issueEvents.length === 1 ? '' : 's'}
            {stream.error ? ' · live updates temporarily unavailable' : ''}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
          {fmtTokens(cost.totalTokens)} tokens · {cost.sessions.length} session
          {cost.sessions.length === 1 ? '' : 's'}
        </div>
      </header>

      <BreakdownTable
        testid="costs-by-stage"
        title="By stage"
        rows={stageRows}
        total={stageRows.reduce((s, r) => s + r.cost, 0)}
      />
      <BreakdownTable
        testid="costs-by-model"
        title="By model"
        rows={modelRows}
        total={modelRows.reduce((s, r) => s + r.cost, 0)}
      />
    </div>
  );
}
