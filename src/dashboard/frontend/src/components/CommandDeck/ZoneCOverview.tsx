/**
 * ZoneCOverview — issue-selected Zone C: tab strip + per-tab body.
 *
 * The tab strip is sticky at the top; the body switches based on the selected
 * tab. Each tab is its own component under `./ZoneCOverviewTabs/` so the data
 * dependencies stay clear and sibling tabs share a query cache via the hooks
 * exported from `./ZoneCOverviewTabs/queries.ts`.
 *
 * INFERENCE tab is hidden when no inference content exists for the issue (the
 * planning endpoint returns it null/empty if no inference.md was generated).
 *
 * The PR/Diff tab pulls from `/api/issues/:issueId/pr` (pan-9yn5) and the
 * Discussions tab pulls from `/api/issues/:issueId/discussions` (pan-1r7j).
 */

import { useState } from 'react';
import { OverviewTab } from './ZoneCOverviewTabs/OverviewTab';
import { ActivityTab } from './ZoneCOverviewTabs/ActivityTab';
import { CostsTab } from './ZoneCOverviewTabs/CostsTab';
import { MarkdownTab } from './ZoneCOverviewTabs/MarkdownTab';
import { VBriefTab } from './ZoneCOverviewTabs/VBriefTab';
import { BeadsTab } from './ZoneCOverviewTabs/BeadsTab';
import { PrDiffTab } from './ZoneCOverviewTabs/PrDiffTab';
import { DiscussionsTab } from './ZoneCOverviewTabs/DiscussionsTab';
import { usePlanningQuery, usePlanningSummaryQuery } from './ZoneCOverviewTabs/queries';

export type OverviewTab =
  | 'overview'
  | 'activity'
  | 'costs'
  | 'prd'
  | 'state'
  | 'inference'
  | 'vbrief'
  | 'beads'
  | 'prdiff'
  | 'discussions';

interface OverviewTabSpec {
  key: OverviewTab;
  label: string;
}

const ALL_TABS: readonly OverviewTabSpec[] = [
  { key: 'overview',    label: 'Overview' },
  { key: 'activity',    label: 'Activity' },
  { key: 'costs',       label: 'Costs' },
  { key: 'prd',         label: 'PRD' },
  { key: 'state',       label: 'STATE' },
  { key: 'inference',   label: 'INFERENCE' },
  { key: 'vbrief',      label: 'vBRIEF' },
  { key: 'beads',       label: 'Beads' },
  { key: 'prdiff',      label: 'PR / Diff' },
  { key: 'discussions', label: 'Discussions' },
];

interface ZoneCOverviewProps {
  issueId: string;
  /** Optional controlled active tab; defaults to 'overview'. */
  activeTab?: OverviewTab;
  onTabChange?: (tab: OverviewTab) => void;
}

export function ZoneCOverview({
  issueId,
  activeTab,
  onTabChange,
}: ZoneCOverviewProps) {
  const [internalTab, setInternalTab] = useState<OverviewTab>('overview');
  const tab = activeTab ?? internalTab;

  const planningSummary = usePlanningSummaryQuery(issueId);
  const shouldLoadPlanning = tab === 'prd' || tab === 'state' || tab === 'inference';
  const planning = usePlanningQuery(issueId, { enabled: shouldLoadPlanning });
  const hasInference = Boolean(planningSummary.data?.hasInference);

  const visibleTabs = ALL_TABS.filter((spec) => spec.key !== 'inference' || hasInference);

  const handleTabClick = (next: OverviewTab) => {
    if (onTabChange) onTabChange(next);
    else setInternalTab(next);
  };

  return (
    <div
      data-testid="zone-c-overview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: 'var(--background)',
      }}
    >
      <div
        role="tablist"
        aria-label={`Issue ${issueId} overview tabs`}
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {visibleTabs.map((spec) => {
          const active = spec.key === tab;
          return (
            <button
              key={spec.key}
              role="tab"
              aria-selected={active}
              data-testid={`zone-c-overview-tab-${spec.key}`}
              onClick={() => handleTabClick(spec.key)}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active
                  ? 'var(--foreground)'
                  : 'var(--muted-foreground)',
                background: active
                  ? 'color-mix(in srgb, var(--primary) 8%, transparent)'
                  : 'transparent',
                border: '1px solid',
                borderColor: active
                  ? 'color-mix(in srgb, var(--primary) 32%, transparent)'
                  : 'transparent',
                borderRadius: 6,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {spec.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        data-testid={`zone-c-overview-panel-${tab}`}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {tab === 'overview' && <OverviewTab issueId={issueId} onSwitchTab={handleTabClick} />}
        {tab === 'activity' && <ActivityTab issueId={issueId} />}
        {tab === 'costs' && <CostsTab issueId={issueId} />}
        {tab === 'prd' && (
          <MarkdownTab
            body={planning.data?.prd}
            isLoading={planning.isLoading}
            emptyLabel="No PRD recorded for this issue. Generate PRD from planning to populate this tab."
          />
        )}
        {tab === 'state' && (
          <MarkdownTab
            body={planning.data?.state}
            isLoading={planning.isLoading}
            emptyLabel="No STATE.md recorded for this issue."
          />
        )}
        {tab === 'inference' && (
          <MarkdownTab
            body={planning.data?.inference}
            isLoading={planning.isLoading}
            emptyLabel="No INFERENCE.md recorded for this issue."
          />
        )}
        {tab === 'vbrief' && <VBriefTab issueId={issueId} />}
        {tab === 'beads' && <BeadsTab issueId={issueId} />}
        {tab === 'prdiff' && <PrDiffTab issueId={issueId} />}
        {tab === 'discussions' && <DiscussionsTab issueId={issueId} />}
      </div>
    </div>
  );
}
