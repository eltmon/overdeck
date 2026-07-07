import { getReviewStatusSync, type ReviewStatus } from '../../../../lib/review-status.js';

export type ResourceStackPhase = 'merged' | 'ship' | 'review' | 'work' | 'plan' | 'ready' | 'todo' | 'verifying';

export interface StackContainerResource {
  id: string;
  name: string;
  cpuPercent?: number;
  memoryUsage?: number;
  memoryLimit?: number;
  diskUsage?: number;
  status?: string;
  labels?: Record<string, string>;
}

export interface ResourceStack {
  id: string;
  issueId: string | null;
  issueTitle: string;
  composeProject: string;
  serviceCount: number;
  services: StackContainerResource[];
  aggregates: {
    cpuPercent: number;
    memoryBytes: number;
    diskBytes: number;
  };
  phase: ResourceStackPhase;
}

let reviewStatusReader: (issueId: string) => ReviewStatus | null = (issueId) => getReviewStatusSync(issueId);

export function getResourceStacks(containers: StackContainerResource[]): ResourceStack[] {
  return buildResourceStacks(containers, reviewStatusesFor(containers));
}

export function buildResourceStacks(
  containers: StackContainerResource[],
  reviewStatuses: Record<string, ReviewStatus | undefined> = {},
): ResourceStack[] {
  const groups = new Map<string, StackContainerResource[]>();

  for (const container of containers) {
    const key = composeProjectFor(container) ?? 'unassigned';
    groups.set(key, [...(groups.get(key) ?? []), container]);
  }

  return [...groups.entries()].map(([composeProject, services]) => {
    const issueId = issueIdFor(composeProject, services);
    const reviewStatus = issueId ? reviewStatuses[issueId] : undefined;
    return {
      id: issueId ?? composeProject,
      issueId,
      issueTitle: issueId ?? 'Unassigned',
      composeProject,
      serviceCount: services.length,
      services,
      aggregates: {
        cpuPercent: roundOne(services.reduce((sum, service) => sum + (service.cpuPercent ?? 0), 0)),
        memoryBytes: services.reduce((sum, service) => sum + (service.memoryUsage ?? 0), 0),
        diskBytes: services.reduce((sum, service) => sum + (service.diskUsage ?? 0), 0),
      },
      phase: phaseFor(reviewStatus),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function setResourceStackReviewStatusReaderForTests(reader: (issueId: string) => ReviewStatus | null): void {
  reviewStatusReader = reader;
}

export function resetResourceStackReviewStatusReaderForTests(): void {
  reviewStatusReader = (issueId) => getReviewStatusSync(issueId);
}

function reviewStatusesFor(containers: StackContainerResource[]): Record<string, ReviewStatus | undefined> {
  const issueIds = new Set<string>();
  const groups = new Map<string, StackContainerResource[]>();
  for (const container of containers) {
    const key = composeProjectFor(container) ?? 'unassigned';
    groups.set(key, [...(groups.get(key) ?? []), container]);
  }
  for (const [composeProject, services] of groups.entries()) {
    const issueId = issueIdFor(composeProject, services);
    if (issueId) issueIds.add(issueId);
  }

  const statuses: Record<string, ReviewStatus | undefined> = {};
  for (const issueId of issueIds) {
    statuses[issueId] = reviewStatusReader(issueId) ?? undefined;
  }
  return statuses;
}

function composeProjectFor(container: StackContainerResource): string | null {
  const labelProject = container.labels?.['com.docker.compose.project']?.trim();
  if (labelProject) return labelProject;

  const issueProject = container.name.match(/^(.+?feature[-_](?:pan|min|aur|krux)[-_]?\d+)/i);
  if (issueProject?.[1]) return issueProject[1];

  const match = container.name.match(/^(.+?)[_-][a-z0-9]+[._-][0-9]+$/i);
  return match?.[1] ?? null;
}

function issueIdFor(composeProject: string, services: StackContainerResource[]): string | null {
  if (composeProject === 'unassigned') return null;
  const fromProject = issueIdFromText(composeProject);
  if (fromProject) return fromProject;

  for (const service of services) {
    const labelText = Object.values(service.labels ?? {}).join(' ');
    const fromLabels = issueIdFromText(labelText);
    if (fromLabels) return fromLabels;
  }

  return null;
}

function issueIdFromText(value: string): string | null {
  const match = value.match(/(?:workspaces[\\/])?feature[-_](pan|min|aur|krux)[-_]?(\d+)/i)
    ?? value.match(/\b(pan|min|aur|krux)[-_]?(\d+)\b/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2]}`;
}

function phaseFor(status: ReviewStatus | undefined): ResourceStackPhase {
  if (!status) return 'todo';
  if (status.mergeStatus === 'merged') return 'merged';
  if (
    status.mergeStatus === 'queued' ||
    status.mergeStatus === 'merging' ||
    status.mergeStatus === 'verifying' ||
    status.mergeStatus === 'failed' ||
    status.readyForMerge === true
  ) return 'ship';
  if (status.verificationStatus === 'running') return 'verifying';
  if (
    status.reviewStatus === 'reviewing' ||
    status.reviewStatus === 'passed' ||
    status.reviewStatus === 'failed' ||
    status.reviewStatus === 'blocked' ||
    status.testStatus === 'testing' ||
    status.testStatus === 'passed' ||
    status.testStatus === 'failed' ||
    status.inspectStatus === 'inspecting' ||
    status.inspectStatus === 'passed' ||
    status.inspectStatus === 'failed' ||
    status.inspectStatus === 'error'
  ) return 'review';
  return 'todo';
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
