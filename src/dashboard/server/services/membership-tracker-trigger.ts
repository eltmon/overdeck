/**
 * PAN-5224 FR-5: a tracker poll that changed an issue's state or labels, or
 * dropped it from the tracker rows, refreshes that project's pipeline
 * membership now, instead of at the 30-minute fallback. Diffs per identifier
 * (never by array index). Never throws.
 */
import { listProjectsSync, resolveProjectFromIssueSync, type ProjectConfig } from '../../../lib/projects.js';
import { enqueueProjectsResourceRefresh } from './project-resource-refresh-queue.js';

interface TrackerIssueLike {
  identifier?: unknown;
  state?: unknown;
  canonicalStatus?: unknown;
  status?: unknown;
  labels?: unknown;
}

function labelNames(issue: TrackerIssueLike): string[] {
  if (!Array.isArray(issue.labels)) return [];
  return issue.labels
    .map((label) => (typeof label === 'string' ? label : (label as { name?: unknown })?.name))
    .filter((name): name is string => typeof name === 'string')
    .sort();
}

function fingerprint(issue: TrackerIssueLike): string {
  const state = String(issue.state ?? issue.canonicalStatus ?? issue.status ?? '');
  return `${state}|${labelNames(issue).join(',')}`;
}

function identifierOf(issue: unknown): string | null {
  const identifier = (issue as TrackerIssueLike | null)?.identifier;
  return typeof identifier === 'string' && identifier.length > 0 ? identifier.toUpperCase() : null;
}

let baseline: Map<string, string> | null = null;

function resolveProject(issueId: string): ProjectConfig | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  return listProjectsSync().find((entry) => entry.key === resolved.projectKey)?.config ?? null;
}

/** Record the baseline without enqueueing anything. */
export function seedTrackerIssues(issues: readonly unknown[]): void {
  try {
    const next = new Map<string, string>();
    for (const issue of issues) {
      const identifier = identifierOf(issue);
      if (identifier) next.set(identifier, fingerprint(issue as TrackerIssueLike));
    }
    baseline = next;
  } catch (error) {
    console.warn('[membership-tracker-trigger] seed failed:', error);
  }
}

/** Diff against the baseline, enqueue changed projects, then make `issues` the baseline. */
export function noteTrackerIssues(issues: readonly unknown[]): void {
  try {
    const next = new Map<string, string>();
    for (const issue of issues) {
      const identifier = identifierOf(issue);
      if (identifier) next.set(identifier, fingerprint(issue as TrackerIssueLike));
    }

    if (!baseline) {
      baseline = next;
      return;
    }

    const changed = new Set<string>();
    for (const [identifier, print] of next) {
      if (baseline.get(identifier) !== print) changed.add(identifier);
    }
    for (const identifier of baseline.keys()) {
      if (!next.has(identifier)) changed.add(identifier);
    }

    baseline = next;
    if (changed.size === 0) return;

    const projects = new Map<string, ProjectConfig>();
    for (const identifier of changed) {
      const project = resolveProject(identifier);
      if (project) projects.set(project.path, project);
    }
    if (projects.size > 0) enqueueProjectsResourceRefresh([...projects.values()], 'tracker:issues-changed');
  } catch (error) {
    console.warn('[membership-tracker-trigger] note failed:', error);
  }
}

/** Tests only. */
export function resetMembershipTrackerTriggerForTests(): void {
  baseline = null;
}
