import { Issue, Agent, LinearProject, STATUS_LABELS } from '../../types';
import type { ReviewStatusSnapshot } from '@overdeck/contracts';

export const COLUMN_COLORS: Record<string, string> = {
  backlog: 'border-border',
  todo: 'border-border',
  in_progress: 'border-primary',
  in_review: 'border-warning',
  verifying_on_main: 'border-info',
  done: 'border-success',
};

export const COLUMN_TITLES: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  verifying_on_main: 'Verifying',
  done: 'Done',
};

export function formatCost(cost: number): string {
  if (cost >= 100) {
    return `$${cost.toFixed(0)}`;
  } else if (cost >= 10) {
    return `$${cost.toFixed(1)}`;
  } else if (cost >= 1) {
    return `$${cost.toFixed(2)}`;
  } else if (cost > 0) {
    return `$${cost.toFixed(2)}`;
  }
  return '';
}

export function getCostColor(_cost: number): string {
  return 'bg-popover text-muted-foreground';
}

export function formatRuntime(startedAt: string): string {
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return '<1 min';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins} min`;
}

export function cardAvatarInitials(name: string): string {
  const parts = name.trim().split(/[-\s_]+/).filter(Boolean);
  if (parts.length > 1) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #a855f7, #06b6d4)',
  'linear-gradient(135deg, #f59e0b, #ef4444)',
  'linear-gradient(135deg, #10b981, #06b6d4)',
  'linear-gradient(135deg, #60a5fa, #a855f7)',
  'linear-gradient(135deg, #ef4444, #f59e0b)',
];

export function avatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
}

export function applyReviewStateToIssue(
  issue: Issue,
  reviewStatus?: Pick<ReviewStatusSnapshot, 'mergeStatus' | 'readyForMerge'>,
): Issue {
  const isMerged = reviewStatus?.mergeStatus === 'merged' || issue.mergeStatus === 'merged' || issue.labels?.some(l => l.toLowerCase() === 'merged');
  if (!isMerged) {
    return {
      ...issue,
      mergeStatus: reviewStatus?.mergeStatus ?? issue.mergeStatus,
    };
  }

  const labels = new Set(issue.labels || []);
  labels.delete('in-review');
  labels.delete('In Review');
  labels.delete('review ready');
  labels.delete('Review Ready');
  labels.add('merged');

  // PAN-1190: keep verifying_on_main visible after merge until close-out completes.
  const canonicalState = issue.targetCanonicalState ?? issue.state ?? STATUS_LABELS[issue.status];
  if (canonicalState === 'verifying_on_main') {
    return {
      ...issue,
      mergeStatus: 'merged',
      labels: Array.from(labels),
      targetCanonicalState: 'verifying_on_main',
    };
  }

  return {
    ...issue,
    status: 'Done',
    mergeStatus: 'merged',
    labels: Array.from(labels),
    targetCanonicalState: 'done',
  };
}

export function shouldShowReviewReadyBadge(
  issue: Issue,
  reviewStatus?: Pick<ReviewStatusSnapshot, 'readyForMerge' | 'mergeStatus'>,
): boolean {
  const canonical = STATUS_LABELS[issue.status] || 'backlog';
  const isMerged = reviewStatus?.mergeStatus === 'merged' || issue.mergeStatus === 'merged' || issue.labels?.some(l => l.toLowerCase() === 'merged');
  const isTerminal = isMerged || canonical === 'done' || canonical === 'canceled';
  if (isTerminal) return false;

  if (reviewStatus) {
    return reviewStatus.readyForMerge === true;
  }

  return issue.labels?.some(
    (label) => typeof label === 'string' && label.toLowerCase() === 'review ready'
  ) ?? false;
}

export function getPipelineCallToAction(
  reviewStatus?: Pick<ReviewStatusSnapshot, 'reviewStatus' | 'testStatus' | 'mergeStatus' | 'verificationStatus' | 'verificationNotes'>,
): { label: string; detail: string; title: string } | null {
  if (!reviewStatus) return null;

  if (reviewStatus.verificationStatus === 'failed') {
    const detail = reviewStatus.verificationNotes || 'Verification failed.';
    return {
      label: 'Next: Review & Test',
      detail,
      title: 'Verification failed — rerun Review & Test to send the failure back through the pipeline.',
    };
  }

  if (reviewStatus.reviewStatus === 'failed' || reviewStatus.reviewStatus === 'blocked') {
    return {
      label: 'Next: Review & Test',
      detail: 'Review did not pass.',
      title: 'Review did not pass — rerun Review & Test after addressing the issue.',
    };
  }

  if (reviewStatus.testStatus === 'failed' || reviewStatus.testStatus === 'dispatch_failed') {
    return {
      label: 'Next: Review & Test',
      detail: 'Tests failed.',
      title: 'Tests failed — rerun Review & Test to continue the pipeline.',
    };
  }

  if (reviewStatus.mergeStatus === 'failed') {
    return {
      label: 'Next: Re-Review',
      detail: 'Merge did not complete.',
      title: 'Merge failed after a prior pass — rerun the pipeline before merging again.',
    };
  }

  return null;
}

export function shouldShowAgentDoneBadge(options: {
  issueStatus: string;
  isTerminal: boolean;
  isPipelineStuck: boolean;
  resolution?: Agent['resolution'];
  hasPendingQuestion: boolean;
}): boolean {
  const canonical = STATUS_LABELS[options.issueStatus] || 'backlog';

  return !options.isTerminal
    && !options.isPipelineStuck
    && canonical !== 'in_review'
    && options.resolution === 'done'
    && !options.hasPendingQuestion;
}

export function groupByStatus(issues: Issue[], showClosedOut: boolean = false): Record<string, Issue[]> {
  const grouped: Record<string, Issue[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    verifying_on_main: [],
    done: [],
    canceled: [],
  };

  for (const issue of issues) {
    // Skip closed-out issues unless explicitly included
    if (!showClosedOut && issue.labels?.some(l => l.toLowerCase() === 'closed-out')) {
      continue;
    }
    // Use targetCanonicalState if available (explicit column from drag-drop)
    // Otherwise fall back to shadowStatus mapping, then tracker status
    let status: string;
    if (issue.targetCanonicalState) {
      // Explicit canonical state from drag-drop - use directly
      status = issue.targetCanonicalState;
    } else if (issue.shadowStatus) {
      // Legacy shadow status mapping
      status = issue.shadowStatus === 'closed' ? 'done' :
               issue.shadowStatus === 'in_progress' ? (STATUS_LABELS[issue.status] || 'in_progress') :
               STATUS_LABELS[issue.status] || 'backlog';
    } else if (issue.derivedStatus) {
      // Derived status from child stories (Rally Features)
      status = issue.derivedStatus === 'closed' ? 'done' :
               issue.derivedStatus === 'in_progress' ? 'in_progress' :
               STATUS_LABELS[issue.status] || 'backlog';
    } else {
      status = STATUS_LABELS[issue.status] || 'backlog';
    }
    // Skip canceled issues - they're shown in a separate filter view, not kanban
    if (status === 'canceled') {
      continue;
    }

    if (grouped[status]) {
      grouped[status].push(issue);
    } else {
      grouped.backlog.push(issue);
    }
  }

  return grouped;
}

export function groupByLabels(issues: Issue[]): Record<string, Issue[]> {
  const grouped: Record<string, Issue[]> = {};
  const uncategorized: Issue[] = [];

  for (const issue of issues) {
    const labels = issue.labels || [];

    if (labels.length === 0) {
      uncategorized.push(issue);
    } else {
      for (const label of labels) {
        if (!grouped[label]) {
          grouped[label] = [];
        }
        grouped[label].push(issue);
      }
    }
  }

  // Add uncategorized group if there are any
  if (uncategorized.length > 0) {
    grouped['Uncategorized'] = uncategorized;
  }

  // Sort groups by label name
  const sorted: Record<string, Issue[]> = {};
  Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .forEach(key => {
      sorted[key] = grouped[key];
    });

  return sorted;
}

export function groupByProject(issues: Issue[]): { name: string; color?: string; issues: Issue[] }[] {
  const projectMap = new Map<string, { name: string; color?: string; issues: Issue[] }>();
  const noProject: Issue[] = [];

  for (const issue of issues) {
    if (issue.project) {
      const existing = projectMap.get(issue.project.id);
      if (existing) {
        existing.issues.push(issue);
      } else {
        projectMap.set(issue.project.id, {
          name: issue.project.name,
          color: issue.project.color,
          issues: [issue],
        });
      }
    } else {
      noProject.push(issue);
    }
  }

  const groups = Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  if (noProject.length > 0) {
    groups.push({ name: 'No Project', issues: noProject });
  }
  return groups;
}

export function groupByCanceledType(issues: Issue[]): { name: string; issues: Issue[] }[] {
  const groups: Record<string, Issue[]> = {
    'Canceled': [],
    'Duplicate': [],
    "Won't Do": [],
    'Other': [],
  };

  for (const issue of issues) {
    const status = issue.status?.toLowerCase() || '';
    if (status === 'canceled' || status === 'cancelled') {
      groups['Canceled'].push(issue);
    } else if (status === 'duplicate') {
      groups['Duplicate'].push(issue);
    } else if (status === "won't do" || status === 'wontfix') {
      groups["Won't Do"].push(issue);
    } else {
      groups['Other'].push(issue);
    }
  }

  // Return non-empty groups in a consistent order
  const result: { name: string; issues: Issue[] }[] = [];
  if (groups['Canceled'].length > 0) result.push({ name: 'Canceled', issues: groups['Canceled'] });
  if (groups['Duplicate'].length > 0) result.push({ name: 'Duplicate', issues: groups['Duplicate'] });
  if (groups["Won't Do"].length > 0) result.push({ name: "Won't Do", issues: groups["Won't Do"] });
  if (groups['Other'].length > 0) result.push({ name: 'Other', issues: groups['Other'] });

  return result;
}

export function generateMockRallyData(): Issue[] {
  const rallyProject: LinearProject = { id: 'mock-rally-project', name: 'HS POS Integrations', color: '#3b82f6' };
  const rallyProject2: LinearProject = { id: 'mock-rally-project-2', name: 'HSv3', color: '#10b981' };

  const features: Issue[] = [
    // Feature in To Do — no children in this column
    {
      id: 'mock-f1', identifier: 'F28993', title: 'Delete/Anonymize PII for Ex-Employees in Payroll Integration',
      status: 'To Do', priority: 2, labels: [], url: '#', createdAt: '2025-01-01', updatedAt: '2025-04-01',
      project: rallyProject, source: 'rally', artifactType: 'PortfolioItem/Feature',
      rawTrackerState: 'Discovering', totalChildCount: 3, completedChildCount: 0, inProgressChildCount: 0,
    },
    // Feature in To Do — no children
    {
      id: 'mock-f2', identifier: 'F29398', title: 'Implement Event-Driven Architecture for Real-Time Sync',
      status: 'To Do', priority: 2, labels: [], url: '#', createdAt: '2025-01-01', updatedAt: '2025-04-01',
      project: rallyProject, source: 'rally', artifactType: 'PortfolioItem/Feature',
      rawTrackerState: 'Discovering', totalChildCount: 5, completedChildCount: 0, inProgressChildCount: 2,
    },
    // Feature in In Progress — derived status, with children in column
    {
      id: 'mock-f3', identifier: 'F29390', title: 'Dir Dev – Small Business Onboarding Flow Redesign',
      status: 'In Progress', priority: 1, labels: [], url: '#', createdAt: '2025-01-01', updatedAt: '2025-04-01',
      project: rallyProject, source: 'rally', artifactType: 'PortfolioItem/Feature',
      rawTrackerState: 'Discovering', derivedStatus: 'in_progress',
      totalChildCount: 4, completedChildCount: 0, inProgressChildCount: 2,
    },
    // Feature in In Progress — with more children
    {
      id: 'mock-f4', identifier: 'F27973', title: 'Direct Development: Ciccio Restaurant Group POS Migration',
      status: 'In Progress', priority: 1, labels: [], url: '#', createdAt: '2025-01-01', updatedAt: '2025-04-01',
      project: rallyProject2, source: 'rally', artifactType: 'PortfolioItem/Feature',
      rawTrackerState: 'Discovering', derivedStatus: 'in_progress',
      totalChildCount: 8, completedChildCount: 3, inProgressChildCount: 3,
    },
    // Feature in Done
    {
      id: 'mock-f5', identifier: 'F28100', title: 'Automated Tip Reconciliation Report Generation',
      status: 'Done', priority: 3, labels: [], url: '#', createdAt: '2025-01-01', updatedAt: '2025-04-01',
      project: rallyProject2, source: 'rally', artifactType: 'PortfolioItem/Feature',
      rawTrackerState: 'Done', derivedStatus: 'closed',
      totalChildCount: 4, completedChildCount: 4, inProgressChildCount: 0,
    },
  ];

  const stories: Issue[] = [
    // Children of F29390 (In Progress)
    {
      id: 'mock-us1', identifier: 'US218080', title: 'LPSLI – Step 1.2: API Integration for Small Biz Validation',
      status: 'In Progress', priority: 2, labels: [], url: '#', createdAt: '2025-02-01', updatedAt: '2025-04-01',
      project: rallyProject, source: 'rally', artifactType: 'HierarchicalRequirement',
      parentRef: 'F29390', rawTrackerState: 'In-Progress',
    },
    {
      id: 'mock-us2', identifier: 'US214008', title: 'LPSLI – Step 2: Assign Default Tax Templates',
      status: 'In Progress', priority: 2, labels: [], url: '#', createdAt: '2025-02-01', updatedAt: '2025-04-01',
      project: rallyProject, source: 'rally', artifactType: 'HierarchicalRequirement',
      parentRef: 'F29390', rawTrackerState: 'In-Progress',
    },
    // Children of F27973 (In Progress)
    {
      id: 'mock-us3', identifier: 'US217395', title: 'Add a warning/alert if menu item prices differ >10% from market avg',
      status: 'In Progress', priority: 2, labels: [], url: '#', createdAt: '2025-02-01', updatedAt: '2025-04-01',
      project: rallyProject2, source: 'rally', artifactType: 'HierarchicalRequirement',
      parentRef: 'F27973', rawTrackerState: 'In-Progress',
    },
    {
      id: 'mock-us4', identifier: 'US204193', title: 'Ensure Adjustment items sync correctly to accounting export',
      status: 'In Progress', priority: 2, labels: [], url: '#', createdAt: '2025-02-01', updatedAt: '2025-04-01',
      project: rallyProject2, source: 'rally', artifactType: 'HierarchicalRequirement',
      parentRef: 'F27973', rawTrackerState: 'In-Progress',
    },
    {
      id: 'mock-us5', identifier: 'US215578', title: 'QA Automation plan for Ciccio migration regression suite',
      status: 'In Progress', priority: 3, labels: [], url: '#', createdAt: '2025-02-01', updatedAt: '2025-04-01',
      project: rallyProject2, source: 'rally', artifactType: 'HierarchicalRequirement',
      parentRef: 'F27973', rawTrackerState: 'Defined',
    },
    // A story in To Do under F28993
    {
      id: 'mock-us6', identifier: 'US220001', title: 'Define PII field inventory for payroll data exports',
      status: 'To Do', priority: 2, labels: [], url: '#', createdAt: '2025-03-01', updatedAt: '2025-04-01',
      project: rallyProject, source: 'rally', artifactType: 'HierarchicalRequirement',
      parentRef: 'F28993', rawTrackerState: 'Defined',
    },
    // Done stories under F28100
    {
      id: 'mock-us7', identifier: 'US210500', title: 'Generate nightly tip reconciliation CSV per location',
      status: 'Done', priority: 2, labels: [], url: '#', createdAt: '2025-01-15', updatedAt: '2025-03-20',
      project: rallyProject2, source: 'rally', artifactType: 'HierarchicalRequirement',
      parentRef: 'F28100', rawTrackerState: 'Accepted',
    },
    {
      id: 'mock-us8', identifier: 'US210501', title: 'Email distribution list for tip reports with PDF attachment',
      status: 'Done', priority: 2, labels: [], url: '#', createdAt: '2025-01-15', updatedAt: '2025-03-22',
      project: rallyProject2, source: 'rally', artifactType: 'HierarchicalRequirement',
      parentRef: 'F28100', rawTrackerState: 'Accepted',
    },
  ];

  return [...features, ...stories];
}

export interface HierarchyGroup {
  type: 'feature' | 'orphan';
  feature?: Issue;
  children: Issue[];
}

export function buildHierarchy(issues: Issue[]): HierarchyGroup[] {
  // Separate features from non-features
  const features: Issue[] = [];
  const nonFeatures: Issue[] = [];

  for (const issue of issues) {
    if (issue.artifactType?.includes('PortfolioItem')) {
      features.push(issue);
    } else {
      nonFeatures.push(issue);
    }
  }

  // If no features, return all as orphans (no grouping needed)
  if (features.length === 0) {
    return issues.map(issue => ({ type: 'orphan', children: [issue] }));
  }

  // Build a map from Feature identifier → Feature issue
  const featureMap = new Map<string, Issue>();
  for (const f of features) {
    featureMap.set(f.identifier, f);
  }

  // Group children by their parentRef
  const childrenByParent = new Map<string, Issue[]>();
  const orphans: Issue[] = [];

  for (const issue of nonFeatures) {
    if (issue.parentRef && featureMap.has(issue.parentRef)) {
      const group = childrenByParent.get(issue.parentRef) || [];
      group.push(issue);
      childrenByParent.set(issue.parentRef, group);
    } else {
      orphans.push(issue);
    }
  }

  // Build the result: feature groups first, then orphans
  const groups: HierarchyGroup[] = [];

  for (const feature of features) {
    const children = childrenByParent.get(feature.identifier) || [];
    groups.push({ type: 'feature', feature, children });
  }

  for (const orphan of orphans) {
    groups.push({ type: 'orphan', children: [orphan] });
  }

  return groups;
}
