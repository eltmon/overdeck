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

import { useEffect, useMemo, useState } from 'react';
import type { Issue, Agent } from '../../types';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import { OverviewTab } from './ZoneCOverviewTabs/OverviewTab';
import { ActivityTab } from './ZoneCOverviewTabs/ActivityTab';
import { CostsTab } from './ZoneCOverviewTabs/CostsTab';
import { MarkdownTab } from './ZoneCOverviewTabs/MarkdownTab';
import { VBriefTab } from './ZoneCOverviewTabs/VBriefTab';
import { BeadsTab } from './ZoneCOverviewTabs/BeadsTab';
import { PrDiffTab } from './ZoneCOverviewTabs/PrDiffTab';
import { DiscussionsTab } from './ZoneCOverviewTabs/DiscussionsTab';
import { usePlanningQuery } from './ZoneCOverviewTabs/queries';

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

function isOverviewTab(value: string | null | undefined): value is OverviewTab {
  return !!value && ALL_TABS.some((tab) => tab.key === value);
}

interface ZoneCOverviewProps {
  issueId: string;
  /** Optional controlled active tab; defaults to 'overview'. */
  activeTab?: OverviewTab;
  onTabChange?: (tab: OverviewTab) => void;
  /** Forwarded to the Activity tab so the Rally / story rollup keeps working. */
  issues?: readonly Issue[];
  featureData?: ProjectFeature | null;
  /** Forwarded to OverviewTab for tile grid data. */
  issue?: Issue;
  /** Work agent for this issue — forwarded to OverviewTab. */
  agent?: Agent;
}

export function ZoneCOverview({
  issueId,
  activeTab,
  onTabChange,
  issues,
  featureData,
  issue,
  agent,
}: ZoneCOverviewProps) {
  const getInitialTab = (): OverviewTab => {
    if (activeTab) return activeTab;
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    return isOverviewTab(fromUrl) ? fromUrl : 'overview';
  };

  const [internalTab, setInternalTab] = useState<OverviewTab>(getInitialTab);
  const tab = activeTab ?? internalTab;

  const planning = usePlanningQuery(issueId);
  const hasInference = !!(planning.data?.inference && planning.data.inference.trim() !== '');

  const visibleTabs = useMemo(
    () => ALL_TABS.filter((spec) => spec.key !== 'inference' || hasInference),
    [hasInference],
  );

  useEffect(() => {
    if (activeTab) return;
    const current = new URLSearchParams(window.location.search).get('tab');
    if (current === tab) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('tab', tab);
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [activeTab, tab]);

  useEffect(() => {
    const onPopState = () => {
      if (activeTab) return;
      const next = new URLSearchParams(window.location.search).get('tab');
      setInternalTab(isOverviewTab(next) ? next : 'overview');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [activeTab]);

  useEffect(() => {
    if (visibleTabs.some((spec) => spec.key === tab)) return;
    if (onTabChange) onTabChange('overview');
    else setInternalTab('overview');
  }, [onTabChange, tab, visibleTabs]);

  const handleTabClick = (next: OverviewTab) => {
    if (onTabChange) onTabChange(next);
    else setInternalTab(next);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('tab', next);
    window.history.pushState(window.history.state, '', nextUrl);
  };

  return (
    <div
      data-testid="zone-c-overview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: 'var(--mc-surface, var(--background))',
      }}
    >
      <div
        role="tablist"
        aria-label={`Issue ${issueId} overview tabs`}
        onKeyDown={(event) => {
          const currentIndex = visibleTabs.findIndex((spec) => spec.key === tab);
          if (currentIndex === -1) return;

          if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
            event.preventDefault();
            const next = visibleTabs[(currentIndex + 1) % visibleTabs.length]?.key;
            if (next) handleTabClick(next);
          }

          if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
            event.preventDefault();
            const next = visibleTabs[(currentIndex - 1 + visibleTabs.length) % visibleTabs.length]?.key;
            if (next) handleTabClick(next);
          }
        }}
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderBottom: '1px solid var(--mc-border, var(--border))',
          overflowX: 'auto',
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          background: 'var(--mc-surface, var(--background))',
          zIndex: 1,
        }}
      >
        {visibleTabs.map((spec) => {
          const active = spec.key === tab;
          return (
            <button
              key={spec.key}
              role="tab"
              aria-selected={active}
              aria-controls={`zone-c-overview-panel-${spec.key}`}
              tabIndex={active ? 0 : -1}
              data-testid={`zone-c-overview-tab-${spec.key}`}
              onClick={() => handleTabClick(spec.key)}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active
                  ? 'var(--mc-text, var(--foreground))'
                  : 'var(--mc-text-muted, var(--muted-foreground))',
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
        id={`zone-c-overview-panel-${tab}`}
        data-testid={`zone-c-overview-panel-${tab}`}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {tab === 'overview' && (
          <OverviewTab
            issueId={issueId}
            onSwitchTab={handleTabClick}
            issue={issue}
            agent={agent}
          />
        )}
        {tab === 'activity' && (
          <ActivityTab issueId={issueId} issues={issues} featureData={featureData} />
        )}
        {tab === 'costs' && <CostsTab issueId={issueId} />}
        {tab === 'prd' && (
          <MarkdownTab
            body={planning.data?.prd}
            isLoading={planning.isLoading}
            emptyLabel="No PRD recorded for this issue."
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
