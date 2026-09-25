import { useState, useEffect, useMemo } from 'react';
import {
  FolderOpen, GitBranch, Radio, BookText, FileText, Bug, Workflow, Container,
} from 'lucide-react';
import type { ProjectFeature, ProjectFeatureResourceIdentifiers, ResourceSource } from './feature-types';
import { useDashboardStore } from '../../../lib/store';
import styles from '../styles/command-deck.module.css';

const RESOURCE_ICON_ORDER: ResourceSource[] = ['workspace', 'branch', 'tmux', 'remote-agent', 'vbrief', 'prd', 'tasks', 'pr', 'docker'];

function resourceColor(_feature: ProjectFeature): string {
  // v1.2 color restraint: resources are infrastructure facts, not status —
  // always neutral. Exceptional states (CI failing) color individual chips.
  return 'var(--muted-foreground)';
}

function formatPrState(pr: { number: number; title: string; state: string; isDraft: boolean }): string {
  const normalizedState = pr.state.toLowerCase();
  return pr.isDraft ? `${normalizedState}, draft` : normalizedState;
}

function resourceSummary(feature: ProjectFeature, source: ResourceSource): { label: string; detail: string } | null {
  const details = feature.resourceDetails;
  if (!details) return null;
  switch (source) {
    case 'workspace':
      return details.hasWorkspace ? { label: 'workspace', detail: 'allocated' } : null;
    case 'branch': {
      const parts: string[] = [];
      if (details.localBranchCount > 0) parts.push(`local ${details.localBranchCount}`);
      if (details.remoteBranchCount > 0) parts.push(`remote ${details.remoteBranchCount}`);
      return parts.length > 0 ? { label: 'branch', detail: parts.join(' · ') } : null;
    }
    case 'tmux':
      return details.tmuxSessionCount > 0 ? { label: 'tmux', detail: `${details.tmuxSessionCount} session${details.tmuxSessionCount === 1 ? '' : 's'}` } : null;
    case 'vbrief':
      return details.hasXbrief ? { label: 'xBRIEF', detail: 'present' } : null;
    case 'prd':
      return details.hasPrd ? { label: 'PRD', detail: 'present' } : null;
    case 'tasks':
      return details.hasTasks ? { label: 'tasks', detail: 'present' } : null;
    case 'pr':
      return details.prs.length > 0
        ? {
            label: 'PR',
            detail: details.prs.map((pr) => `#${pr.number} (${formatPrState(pr)})`).join(' · '),
          }
        : null;
    case 'docker':
      return details.dockerContainerCount > 0 ? { label: 'docker', detail: `${details.dockerContainerCount} container${details.dockerContainerCount === 1 ? '' : 's'}` } : null;
    case 'remote-agent':
      return details.remoteAgent ? { label: 'fly.io', detail: `${details.remoteAgent.vmName} (${details.remoteAgent.status})` } : null;
    default:
      return null;
  }
}

export function isOrphanedFeature(feature: ProjectFeature): boolean {
  const state = feature.stateLabel.toLowerCase();
  const rawState = feature.rawTrackerState?.toLowerCase() ?? '';
  return state.includes('closed') || state.includes('done') || rawState.includes('closed') || rawState.includes('done');
}

function handleActivateKeyDown(event: React.KeyboardEvent, onActivate: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  }
}

function ResourceIcon({
  source,
  feature,
  onActivate,
}: {
  source: ResourceSource;
  feature: ProjectFeature;
  onActivate?: () => void;
}) {
  const color = resourceColor(feature);
  const summary = resourceSummary(feature, source);
  if (!summary) return null;
  const props = { size: 12, color, 'aria-hidden': true as const };
  const icon = source === 'workspace' ? <FolderOpen {...props} />
    : source === 'branch' ? <GitBranch {...props} />
      : source === 'tmux' ? <Radio {...props} />
        : source === 'vbrief' ? <BookText {...props} />
          : source === 'prd' ? <FileText {...props} />
            : source === 'tasks' ? <Bug {...props} />
            : source === 'pr' ? <Workflow {...props} />
              : <Container {...props} />;
  // Icons are icon-only; the tasks and PR icons carry a compact technical
  // count/id, everything else's fact lives only in title/aria-label.
  const badgeText = source === 'tasks' && feature.taskTotals
    ? `${feature.taskTotals.closed}/${feature.taskTotals.total}`
    : source === 'pr' && feature.resourceDetails?.prs.length
      ? `#${feature.resourceDetails.prs[0].number}`
      : null;
  const content = <>{icon}{badgeText && <span>{badgeText}</span>}</>;

  if (onActivate) {
    return (
      <span
        role="button"
        tabIndex={0}
        className={styles.featureResourceChip}
        title={`${summary.label}: ${summary.detail}`}
        aria-label={`Open ${summary.label} for ${feature.issueId}`}
        onClick={(event) => {
          event.stopPropagation();
          onActivate();
        }}
        onKeyDown={(event) => handleActivateKeyDown(event, onActivate)}
        onFocus={(event) => event.stopPropagation()}
        onBlur={(event) => event.stopPropagation()}
      >
        {content}
      </span>
    );
  }

  return (
    <span className={styles.featureResourceChip} title={`${summary.label}: ${summary.detail}`} aria-label={`${summary.label}: ${summary.detail}`}>
      {content}
    </span>
  );
}

export function ResourceCluster({
  feature,
  onCleanupOrphanedResources,
}: {
  feature: ProjectFeature;
  onCleanupOrphanedResources?: (issueId: string) => void;
}) {
  const details = feature.resourceDetails;
  const openTasksViewer = useDashboardStore((state) => state.openTasksViewer);
  const openPrdViewer = useDashboardStore((state) => state.openPrdViewer);
  const openXbriefViewer = useDashboardStore((state) => state.openXbriefViewer);
  const resources = RESOURCE_ICON_ORDER.filter((source) => feature.resourceSources?.includes(source) && resourceSummary(feature, source));
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [detailIdentifiers, setDetailIdentifiers] = useState<ProjectFeatureResourceIdentifiers | null>(null);
  const orphaned = isOrphanedFeature(feature);
  const shouldRender = resources.length > 0;

  useEffect(() => {
    if (!shouldRender) return;
    if (!popoverOpen) return;
    if (!details) return;
    if (!feature.issueId) return;
    if (detailIdentifiers) return;

    let cancelled = false;
    void fetch(`/api/issues/${encodeURIComponent(feature.issueId)}/resource-details`)
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<ProjectFeatureResourceIdentifiers>;
      })
      .then((payload) => {
        if (cancelled || !payload) return;
        setDetailIdentifiers(payload);
      })
      .catch(() => {
        // Fall back to summary-only rows when detail fetch fails.
      });

    return () => {
      cancelled = true;
    };
  }, [shouldRender, popoverOpen, details, feature.issueId, detailIdentifiers]);

  const resourceRows = useMemo(() => {
    if (!details) return [] as Array<{ key: string; label: string }>;

    const identifiers = detailIdentifiers;
    const rows: Array<{ key: string; label: string }> = [];

    if ((identifiers?.workspacePaths.length ?? 0) > 0) {
      for (const workspacePath of identifiers?.workspacePaths ?? []) {
        rows.push({ key: `workspace-${workspacePath}`, label: `workspace: ${workspacePath}` });
      }
    } else if (details.hasWorkspace) {
      rows.push({ key: 'workspace', label: 'workspace allocated' });
    }

    if ((identifiers?.localBranchNames.length ?? 0) > 0 || (identifiers?.remoteBranchNames.length ?? 0) > 0) {
      for (const branchName of identifiers?.localBranchNames ?? []) {
        rows.push({ key: `local-branch-${branchName}`, label: `branch (local): ${branchName}` });
      }
      for (const branchName of identifiers?.remoteBranchNames ?? []) {
        rows.push({ key: `remote-branch-${branchName}`, label: `branch (remote): ${branchName}` });
      }
    } else if (details.localBranchCount > 0 || details.remoteBranchCount > 0) {
      rows.push({ key: 'branch', label: `branches: ${details.localBranchCount} local · ${details.remoteBranchCount} remote` });
    }

    if ((identifiers?.tmuxSessionNames.length ?? 0) > 0) {
      for (const sessionName of identifiers?.tmuxSessionNames ?? []) {
        rows.push({ key: `tmux-${sessionName}`, label: `tmux: ${sessionName}` });
      }
    } else if (details.tmuxSessionCount > 0) {
      rows.push({ key: 'tmux', label: `tmux: ${details.tmuxSessionCount} active session${details.tmuxSessionCount === 1 ? '' : 's'}` });
    }

    if (details.remoteAgent) {
      rows.push({ key: 'remote-agent', label: `fly.io: ${details.remoteAgent.vmName} · ${details.remoteAgent.status} · ${details.remoteAgent.model}` });
    }

    if (details.hasXbrief) rows.push({ key: 'vbrief', label: 'xBRIEF present' });
    if (details.hasPrd) rows.push({ key: 'prd', label: 'PRD present' });
    if (details.hasTasks) rows.push({ key: 'tasks', label: 'tasks present' });
    for (const pr of identifiers?.prs ?? details.prs) {
      rows.push({ key: `pr-${pr.number}`, label: `PR: #${pr.number} ${pr.title} (${formatPrState(pr)})` });
    }

    if ((identifiers?.dockerContainerNames.length ?? 0) > 0) {
      for (const containerName of identifiers?.dockerContainerNames ?? []) {
        rows.push({ key: `docker-${containerName}`, label: `docker: ${containerName}` });
      }
    } else if (details.dockerContainerCount > 0) {
      rows.push({ key: 'docker', label: `docker: ${details.dockerContainerCount} running container${details.dockerContainerCount === 1 ? '' : 's'}` });
    }

    return rows;
  }, [details, detailIdentifiers]);

  if (!shouldRender) return null;

  return (
    <span
      className={styles.featureResourceStrip}
      onMouseEnter={() => setPopoverOpen(true)}
      onMouseLeave={() => setPopoverOpen(false)}
      onFocus={() => setPopoverOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPopoverOpen(false);
        }
      }}
    >
      {resources.map((source) => (
        <ResourceIcon
          key={source}
          source={source}
          feature={feature}
          onActivate={source === 'vbrief'
            ? () => openXbriefViewer(feature.issueId)
            : source === 'tasks'
              ? () => openTasksViewer(feature.issueId)
              : source === 'prd'
                ? () => openPrdViewer(feature.issueId)
                : undefined}
        />
      ))}
      {details && popoverOpen && (
        <span className={styles.featureResourcePopover}>
          {resourceRows.map((row) => (
            <span key={row.key} className={styles.featureResourceRow}>
              <span>{row.label}</span>
              {orphaned && onCleanupOrphanedResources && !row.key.startsWith('pr-') && (
                <span
                  role="button"
                  tabIndex={0}
                  className={styles.featureResourceCleanupButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCleanupOrphanedResources(feature.issueId);
                  }}
                  onKeyDown={(event) => handleActivateKeyDown(event, () => onCleanupOrphanedResources(feature.issueId))}
                  title={`Clean up orphaned ${row.key} resources`}
                >
                  Cleanup
                </span>
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
