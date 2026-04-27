/**
 * ZoneCOverview — issue-selected Zone C: tab strip + per-tab body.
 *
 * The tab strip is sticky at the top. PAN-865 only delivers the Overview body;
 * the other nine tabs intentionally render placeholders so their full content
 * can land in PAN-866 without expanding this issue's scope.
 */

import { useEffect, useRef, useState } from 'react';
import type { Issue, Agent } from '../../types';
import { OverviewTab } from './ZoneCOverviewTabs/OverviewTab';

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

function PlaceholderBody() {
  return (
    <div
      data-testid="zone-c-overview-placeholder"
      style={{
        padding: '2rem',
        textAlign: 'center',
        color: 'var(--mc-text-muted, var(--muted-foreground))',
      }}
    >
      Coming soon
    </div>
  );
}

interface ZoneCOverviewProps {
  issueId: string;
  /** Optional controlled active tab; defaults to 'overview'. */
  activeTab?: OverviewTab;
  onTabChange?: (tab: OverviewTab) => void;
  issue?: Issue;
  agent?: Agent;
}

export function ZoneCOverview({
  issueId,
  activeTab,
  onTabChange,
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
  const tabRefs = useRef<Record<OverviewTab, HTMLButtonElement | null>>({
    overview: null,
    activity: null,
    costs: null,
    prd: null,
    state: null,
    inference: null,
    vbrief: null,
    beads: null,
    prdiff: null,
    discussions: null,
  });

  const visibleTabs = ALL_TABS;

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

    if (!activeTab) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('tab', next);
      window.history.pushState(window.history.state, '', nextUrl);
    }
  };

  const moveTabFocus = (next: OverviewTab) => {
    handleTabClick(next);
    tabRefs.current[next]?.focus();
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

          if (event.key === 'ArrowRight') {
            event.preventDefault();
            const next = visibleTabs[(currentIndex + 1) % visibleTabs.length]?.key;
            if (next) moveTabFocus(next);
          }

          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            const next = visibleTabs[(currentIndex - 1 + visibleTabs.length) % visibleTabs.length]?.key;
            if (next) moveTabFocus(next);
          }

          if (event.key === 'Home') {
            event.preventDefault();
            const next = visibleTabs[0]?.key;
            if (next) moveTabFocus(next);
          }

          if (event.key === 'End') {
            event.preventDefault();
            const next = visibleTabs[visibleTabs.length - 1]?.key;
            if (next) moveTabFocus(next);
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
              ref={(node) => {
                tabRefs.current[spec.key] = node;
              }}
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
        {tab !== 'overview' && <PlaceholderBody />}
      </div>
    </div>
  );
}
