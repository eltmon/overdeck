/**
 * ProjectLens — tabbed per-project lens for the Command Deck right pane.
 *
 * Replaces ProjectOverview with a tabbed interface:
 *   Pipeline  → project-filtered IssueRow list grouped by phase
 *   Plans     → OverviewTab for the active issue
 *   Beads     → BeadsTab for the active issue
 *   Conversations → DiscussionsTab for the active issue
 *   Activity  → ActivityTab for the active issue
 *   Settings  → CostsTab for the active issue
 *
 * Tab selection persists in localStorage scoped per-project.
 * Clicking an IssueRow in Pipeline sets the active issue for the detail tabs.
 */

import { useState, useMemo, useCallback } from 'react';
import type { Agent, Issue } from '../../types';
import { useDashboardStore } from '../../lib/store';
import type { ReviewStatusSnapshot } from '@panctl/contracts';
import type { ProjectFeature } from './ProjectTree/ProjectNode';
import type { IssueCostBreakdown } from './ProjectOverview';
import IssueRow from '../primitives/IssueRow';
import VerbBadge from '../primitives/VerbBadge';
import PhaseHeader from '../primitives/PhaseHeader';
import { OverviewTab } from './ZoneCOverviewTabs/OverviewTab';
import { BeadsTab } from './ZoneCOverviewTabs/BeadsTab';
import { ActivityTab } from './ZoneCOverviewTabs/ActivityTab';
import { CostsTab } from './ZoneCOverviewTabs/CostsTab';
import { DiscussionsTab } from './ZoneCOverviewTabs/DiscussionsTab';

export type ProjectLensTab = 'pipeline' | 'plans' | 'beads' | 'conversations' | 'activity' | 'settings';

interface ProjectLensProps {
  projectName: string;
  features: ProjectFeature[];
  issueCosts: Record<string, number>;
  issueCostDetails?: Record<string, IssueCostBreakdown>;
  onSelectFeature?: (feature: ProjectFeature) => void;
  /** Full issue records for priority/assignee/labels lookup */
  issues?: Issue[];
  /** Agents for the active issue overview tab */
  agents?: Agent[];
}

const TAB_SPECS: readonly { key: ProjectLensTab; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'plans', label: 'Plans' },
  { key: 'beads', label: 'Beads' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'activity', label: 'Activity' },
  { key: 'settings', label: 'Settings' },
];

const PHASE_ORDER: readonly ('ship' | 'review' | 'work' | 'plan' | 'todo')[] = [
  'ship',
  'review',
  'work',
  'plan',
  'todo',
];

function tabStorageKey(projectName: string): string {
  return `project-lens-tab-${projectName}`;
}

function activeIssueStorageKey(projectName: string): string {
  return `project-lens-issue-${projectName}`;
}

function readStoredTab(projectName: string): ProjectLensTab {
  try {
    const raw = localStorage.getItem(tabStorageKey(projectName));
    if (raw && TAB_SPECS.some((t) => t.key === raw)) return raw as ProjectLensTab;
  } catch { /* ignore */ }
  return 'pipeline';
}

function writeStoredTab(projectName: string, tab: ProjectLensTab) {
  try {
    localStorage.setItem(tabStorageKey(projectName), tab);
  } catch { /* ignore */ }
}

function readStoredActiveIssue(projectName: string): string | null {
  try {
    return localStorage.getItem(activeIssueStorageKey(projectName));
  } catch { return null; }
}

function writeStoredActiveIssue(projectName: string, issueId: string | null) {
  try {
    if (issueId) localStorage.setItem(activeIssueStorageKey(projectName), issueId);
    else localStorage.removeItem(activeIssueStorageKey(projectName));
  } catch { /* ignore */ }
}

// ── Phase classification ────────────────────────────────────────────────────

type NaturalPhase = 'ship' | 'review' | 'work' | 'plan' | 'todo';

const MERGING_STATUSES = new Set(['queued', 'merging', 'verifying']);
const REVIEW_STUCK_STATUSES = new Set(['failed', 'blocked']);
const TEST_STUCK_STATUSES = new Set(['failed', 'dispatch_failed']);
const MERGE_STUCK_STATUSES = new Set(['failed']);
const VERIFICATION_STUCK_STATUSES = new Set(['failed']);
const ACTIVE_AGENT_STATUSES = new Set(['active', 'running', 'starting']);

function hasActiveWorkSession(feature: ProjectFeature): boolean {
  return feature.sessions?.some((s) => s.type === 'work' && s.presence === 'active') ?? false;
}

function hasActiveAgentSignal(feature: ProjectFeature): boolean {
  return hasActiveWorkSession(feature) || ACTIVE_AGENT_STATUSES.has(feature.agentStatus ?? '');
}

function classifyPhase(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): { phase: NaturalPhase; isStuck: boolean } {
  const isStuck =
    reviewStatus?.stuck === true ||
    REVIEW_STUCK_STATUSES.has(reviewStatus?.reviewStatus ?? '') ||
    TEST_STUCK_STATUSES.has(reviewStatus?.testStatus ?? '') ||
    MERGE_STUCK_STATUSES.has(reviewStatus?.mergeStatus ?? '') ||
    VERIFICATION_STUCK_STATUSES.has(reviewStatus?.verificationStatus ?? '') ||
    (reviewStatus?.blockerReasons != null && reviewStatus.blockerReasons.length > 0);

  if (reviewStatus?.mergeStatus && MERGING_STATUSES.has(reviewStatus.mergeStatus)) {
    return { phase: 'ship', isStuck };
  }
  if (reviewStatus?.readyForMerge && (!reviewStatus.blockerReasons || reviewStatus.blockerReasons.length === 0)) {
    return { phase: 'ship', isStuck };
  }
  if (reviewStatus?.testStatus === 'testing') {
    return { phase: 'review', isStuck };
  }
  if (reviewStatus?.reviewStatus === 'reviewing') {
    return { phase: 'review', isStuck };
  }
  if (reviewStatus?.verificationStatus === 'running') {
    return { phase: 'review', isStuck };
  }
  if (hasActiveAgentSignal(feature) && !reviewStatus) {
    return { phase: 'work', isStuck };
  }
  if (feature.hasPlanning && !feature.sessions?.some((s) => s.type === 'work')) {
    return { phase: 'plan', isStuck };
  }
  return { phase: 'todo', isStuck };
}

// ── Verb badge derivation ───────────────────────────────────────────────────

function deriveVerbBadge(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): React.ReactNode {
  if (reviewStatus?.stuck === true) {
    const hours = computeStuckHours(reviewStatus);
    return <VerbBadge variant="STUCK · Nh" hours={hours} />;
  }
  if (REVIEW_STUCK_STATUSES.has(reviewStatus?.reviewStatus ?? '')) {
    const hours = computeStuckHours(reviewStatus);
    return <VerbBadge variant="STUCK · Nh" hours={hours} />;
  }
  if (TEST_STUCK_STATUSES.has(reviewStatus?.testStatus ?? '')) {
    const hours = computeStuckHours(reviewStatus);
    return <VerbBadge variant="STUCK · Nh" hours={hours} />;
  }
  if (MERGE_STUCK_STATUSES.has(reviewStatus?.mergeStatus ?? '')) {
    const hours = computeStuckHours(reviewStatus);
    return <VerbBadge variant="STUCK · Nh" hours={hours} />;
  }
  if (VERIFICATION_STUCK_STATUSES.has(reviewStatus?.verificationStatus ?? '')) {
    const hours = computeStuckHours(reviewStatus);
    return <VerbBadge variant="STUCK · Nh" hours={hours} />;
  }
  if (reviewStatus?.mergeStatus && MERGING_STATUSES.has(reviewStatus.mergeStatus)) {
    return <VerbBadge variant="SHIP RUNNING" />;
  }
  if (reviewStatus?.readyForMerge) {
    return <VerbBadge variant="READY TO MERGE" />;
  }
  if (reviewStatus?.testStatus === 'testing') {
    return <VerbBadge variant="REVIEW RUNNING" />;
  }
  if (reviewStatus?.reviewStatus === 'reviewing') {
    return <VerbBadge variant="REVIEW RUNNING" />;
  }
  if (reviewStatus?.verificationStatus === 'running') {
    return <VerbBadge variant="REVIEW RUNNING" />;
  }
  if (hasActiveAgentSignal(feature)) {
    return <VerbBadge variant="WORK RUNNING" />;
  }
  if (feature.hasPlanning && !feature.sessions?.some((s) => s.type === 'work')) {
    return <VerbBadge variant="PLANNING" />;
  }
  if (feature.status === 'closed' || feature.status === 'merged') {
    return <VerbBadge variant="MERGED" />;
  }
  return null;
}

function computeStuckHours(reviewStatus: ReviewStatusSnapshot | undefined): number {
  const ref = reviewStatus?.stuckAt ?? reviewStatus?.updatedAt;
  if (!ref) return 0;
  const ms = Date.now() - Date.parse(ref);
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.max(0, Math.round(ms / 3_600_000));
}

// ── Priority mapping ────────────────────────────────────────────────────────

function mapPriority(priorityNum: number | undefined): 'urgent' | 'high' | 'medium' | 'low' {
  if (priorityNum === 1) return 'urgent';
  if (priorityNum === 2) return 'high';
  if (priorityNum === 3) return 'medium';
  return 'low';
}

// ── Component ───────────────────────────────────────────────────────────────

export function ProjectLens({
  projectName,
  features,
  issueCosts,
  issueCostDetails,
  onSelectFeature,
  issues = [],
  agents = [],
}: ProjectLensProps) {
  const [activeTab, setActiveTab] = useState<ProjectLensTab>(() => readStoredTab(projectName));
  const [activeIssueId, setActiveIssueId] = useState<string | null>(() => {
    const stored = readStoredActiveIssue(projectName);
    // Only use stored if it exists in current features
    return stored && features.some((f) => f.issueId === stored) ? stored : null;
  });

  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);

  const issueMap = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) {
      if (issue.identifier) {
        map.set(issue.identifier, issue);
        map.set(issue.identifier.toLowerCase(), issue);
      }
    }
    return map;
  }, [issues]);

  const handleTabChange = useCallback(
    (tab: ProjectLensTab) => {
      setActiveTab(tab);
      writeStoredTab(projectName, tab);
    },
    [projectName],
  );

  const handleIssueClick = useCallback(
    (issueId: string) => {
      setActiveIssueId(issueId);
      writeStoredActiveIssue(projectName, issueId);
      // If the user is clicking an issue, also switch to Plans tab for detail viewing
      setActiveTab((prev) => {
        if (prev === 'pipeline') {
          writeStoredTab(projectName, 'plans');
          return 'plans';
        }
        return prev;
      });
    },
    [projectName],
  );

  // Build phase buckets
  const phaseBuckets = useMemo(() => {
    const buckets: Record<NaturalPhase, Array<{ feature: ProjectFeature; reviewStatus: ReviewStatusSnapshot | undefined }>> = {
      ship: [],
      review: [],
      work: [],
      plan: [],
      todo: [],
    };

    for (const feature of features) {
      const reviewStatus = reviewStatusByIssueId[feature.issueId];
      const { phase } = classifyPhase(feature, reviewStatus);
      buckets[phase].push({ feature, reviewStatus });
    }

    // Sort each bucket by priority desc, then updatedAt desc
    for (const phase of PHASE_ORDER) {
      buckets[phase].sort((a, b) => {
        const issueA = issueMap.get(a.feature.issueId) ?? issueMap.get(a.feature.issueId.toLowerCase());
        const issueB = issueMap.get(b.feature.issueId) ?? issueMap.get(b.feature.issueId.toLowerCase());
        const prioA = issueA?.priority ?? 999;
        const prioB = issueB?.priority ?? 999;
        if (prioA !== prioB) return prioA - prioB;
        const updatedA = issueA?.updatedAt ?? '';
        const updatedB = issueB?.updatedAt ?? '';
        return updatedB.localeCompare(updatedA);
      });
    }

    return buckets;
  }, [features, reviewStatusByIssueId, issueMap]);

  // Resolve active issue for detail tabs
  const activeIssue = useMemo(() => {
    if (activeIssueId) {
      const found = issueMap.get(activeIssueId) ?? issueMap.get(activeIssueId.toLowerCase());
      if (found) return found;
    }
    // Default to first feature's issue
    if (features.length > 0) {
      const first = features[0];
      return issueMap.get(first.issueId) ?? issueMap.get(first.issueId.toLowerCase());
    }
    return null;
  }, [activeIssueId, features, issueMap]);

  const activeIssueAgent = useMemo(() => {
    if (!activeIssue) return undefined;
    const key = activeIssue.identifier.toLowerCase();
    return agents.find((a) => a.issueId?.toLowerCase() === key && a.id.startsWith('agent-'))
      ?? agents.find((a) => a.issueId?.toLowerCase() === key);
  }, [activeIssue, agents]);

  const activeIssueIdForTabs = activeIssue?.identifier ?? '';

  return (
    <div
      data-testid="project-lens"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: 'var(--background)',
      }}
    >
      {/* Tab strip */}
      <div
        role="tablist"
        aria-label={`${projectName} project lens tabs`}
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {TAB_SPECS.map((spec) => {
          const active = spec.key === activeTab;
          return (
            <button
              key={spec.key}
              role="tab"
              aria-selected={active}
              data-testid={`project-lens-tab-${spec.key}`}
              onClick={() => handleTabChange(spec.key)}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--foreground)' : 'var(--muted-foreground)',
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

      {/* Tab content */}
      <div
        role="tabpanel"
        data-testid={`project-lens-panel-${activeTab}`}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {activeTab === 'pipeline' && (
          <div data-testid="project-lens-pipeline" style={{ display: 'flex', flexDirection: 'column' }}>
            {PHASE_ORDER.map((phase) => {
              const entries = phaseBuckets[phase];
              return (
                <div key={phase} data-testid={`project-lens-phase-${phase}`}>
                  <PhaseHeader
                    phase={phase}
                    count={entries.length}
                    variant="command-deck"
                  />
                  {entries.length === 0 ? (
                    <div
                      style={{
                        padding: '12px 22px',
                        fontSize: 12,
                        color: 'var(--muted-foreground)',
                        fontStyle: 'italic',
                      }}
                    >
                      No issues
                    </div>
                  ) : (
                    entries.map(({ feature, reviewStatus }) => {
                      const issue = issueMap.get(feature.issueId) ?? issueMap.get(feature.issueId.toLowerCase());
                      const priority = mapPriority(issue?.priority);
                      const { phase: naturalPhase } = classifyPhase(feature, reviewStatus);
                      const verbBadge = deriveVerbBadge(feature, reviewStatus);
                      const cost = issueCosts[feature.issueId] ?? issueCosts[feature.issueId.toLowerCase()] ?? 0;
                      const costDetail = issueCostDetails?.[feature.issueId] ?? issueCostDetails?.[feature.issueId.toLowerCase()];
                      const runtime = deriveRuntime(feature, reviewStatus);

                      return (
                        <IssueRow
                          key={feature.issueId}
                          issueId={feature.issueId}
                          phase={naturalPhase === 'todo' ? 'todo' : naturalPhase}
                          priority={priority}
                          title={feature.title}
                          labels={issue?.labels?.map((l) => l) ?? []}
                          verbBadge={verbBadge}
                          ledger={{
                            runtime,
                            cost: cost > 0 ? `$${cost.toFixed(2)}` : '—',
                          }}
                          assignee={issue?.assignee ? { name: issue.assignee.name } : undefined}
                          variant="command-deck"
                          onOpen={handleIssueClick}
                        />
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'plans' && activeIssueIdForTabs && (
          <OverviewTab
            issueId={activeIssueIdForTabs}
            agent={activeIssueAgent}
            issue={activeIssue ?? undefined}
          />
        )}

        {activeTab === 'beads' && activeIssueIdForTabs && (
          <BeadsTab issueId={activeIssueIdForTabs} />
        )}

        {activeTab === 'conversations' && activeIssueIdForTabs && (
          <DiscussionsTab issueId={activeIssueIdForTabs} />
        )}

        {activeTab === 'activity' && activeIssueIdForTabs && (
          <ActivityTab issueId={activeIssueIdForTabs} />
        )}

        {activeTab === 'settings' && activeIssueIdForTabs && (
          <CostsTab issueId={activeIssueIdForTabs} />
        )}

        {activeTab !== 'pipeline' && !activeIssueIdForTabs && (
          <div
            data-testid="project-lens-no-issue"
            style={{
              padding: 40,
              textAlign: 'center',
              fontSize: 13,
              color: 'var(--muted-foreground)',
            }}
          >
            No issues in this project.
          </div>
        )}
      </div>
    </div>
  );
}

function deriveRuntime(feature: ProjectFeature, reviewStatus: ReviewStatusSnapshot | undefined): string {
  // Prefer active work session startedAt
  const activeWork = feature.sessions?.find((s) => s.type === 'work' && s.presence === 'active');
  if (activeWork?.startedAt) {
    return formatRuntime(activeWork.startedAt);
  }
  // Fall back to reviewStatus updatedAt for in-flight review/merge
  if (reviewStatus?.updatedAt) {
    return formatRuntime(reviewStatus.updatedAt);
  }
  return '—';
}

function formatRuntime(startedAt: string): string {
  const ms = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
