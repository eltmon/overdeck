/**
 * ZoneCOverview — issue-selected Zone C: tab strip skeleton.
 *
 * The Phase-2 shell deliverable lands the tab strip and "tab body" container
 * only. Each tab's actual content (Overview billboard, PRD render, vBRIEF
 * embed, Beads list, PR/Diff, etc.) lands in pan-ofa3 (Phase 4) per the PRD —
 * keeping this bead structural means the layout can be reviewed without
 * blocking on tab content readiness.
 *
 * The Activity tab in particular reuses the existing `<ActivityFeed>` once
 * Phase 4 wires it in; for now each tab body shows a placeholder.
 */

import { useState } from 'react';

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

const TABS: readonly OverviewTabSpec[] = [
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

export function ZoneCOverview({ issueId, activeTab, onTabChange }: ZoneCOverviewProps) {
  const [internalTab, setInternalTab] = useState<OverviewTab>('overview');
  const tab = activeTab ?? internalTab;

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
        background: 'var(--mc-surface, var(--background))',
      }}
    >
      <div
        role="tablist"
        aria-label={`Issue ${issueId} overview tabs`}
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderBottom: '1px solid var(--mc-border, var(--border))',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {TABS.map((spec) => {
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
        data-testid={`zone-c-overview-panel-${tab}`}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: 16,
          color: 'var(--mc-text-muted, var(--muted-foreground))',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Overview content for <strong>{issueId}</strong> · tab: <em>{tab}</em>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          Tab content lands in pan-ofa3 (Phase 4).
        </div>
      </div>
    </div>
  );
}
