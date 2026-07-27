import { Effect } from 'effect';
import {
  EPIC_LABEL,
  LEGACY_PARKED_LABELS,
  OBJECTION_LABEL,
  PARKED_LABEL,
  READY_LABEL,
  RELEASED_LABEL,
  VETOED_LABEL,
} from '../backlog/pickup.js';
import { isFlywheelAutoPickupBacklog } from '../overdeck/control-settings.js';
import { findSpecByIssue } from '../pan-dir/specs.js';
import { readAutoSpawnOnFinalizeFlagAsync } from '../planning/spawn-planning-session.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { activeOrderBookIssues } from './flywheel.js';

export interface AutonomousWorkDispatchInput {
  labels: readonly string[] | null;
  planned: boolean;
  autoPickupBacklog: boolean;
  activeBookMember: boolean;
  autoSpawnOnFinalizeConsent: boolean;
}

type PlannedState = { status: string; itemCount: number } | null;

export interface AutonomousWorkDispatchDeps {
  getIssues?: () => Array<Record<string, unknown>>;
  isAutoPickupBacklog?: () => boolean | Promise<boolean>;
  resolveProject?: typeof resolveProjectFromIssueSync;
  activeBookIssues?: typeof activeOrderBookIssues;
  readAutoSpawnConsent?: (issueId: string) => boolean | Promise<boolean>;
  findPlannedState?: (projectRoot: string, issueId: string) => Promise<PlannedState>;
  knownPlanned?: boolean;
  now?: () => number;
}

export type AutonomousWorkReleaseSource =
  | 'released-label'
  | 'auto-pickup'
  | 'active-order-book'
  | 'planning-consent';

export type AutonomousWorkDispatchDecision =
  | { allow: true; releaseSource: AutonomousWorkReleaseSource }
  | {
      allow: false;
      code:
        | 'not-ready'
        | 'not-planned'
        | 'not-released'
        | 'parked'
        | 'vetoed'
        | 'objection'
        | 'epic'
        | 'labels-unavailable';
      reason: string;
    };

const RELEASE_CONTEXT_CACHE_MS = 5_000;
let autoPickupCache: { expiresAt: number; value: boolean } | null = null;
const activeBookCache = new Map<string, { expiresAt: number; value: ReadonlySet<string> }>();

export function clearAutonomousWorkDispatchCaches(): void {
  autoPickupCache = null;
  activeBookCache.clear();
}

function getSharedIssues(): Array<Record<string, unknown>> {
  // Keep this lazy require aligned with autonomous-plan-dispatch: a static
  // import creates a lib → dashboard layering edge.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSharedIssueService } = require('../../dashboard/server/services/issue-service-singleton.js') as typeof import('../../dashboard/server/services/issue-service-singleton.js');
  return getSharedIssueService().getIssues() as Array<Record<string, unknown>>;
}

async function defaultFindPlannedState(projectRoot: string, issueId: string): Promise<PlannedState> {
  const entry = await Effect.runPromise(
    findSpecByIssue(projectRoot, issueId).pipe(Effect.catch(() => Effect.succeed(null))),
  );
  if (!entry) return null;
  return {
    status: entry.status,
    itemCount: Array.isArray(entry.document.plan?.items) ? entry.document.plan.items.length : 0,
  };
}

function isPlannedState(state: PlannedState): boolean {
  return state !== null
    && (state.status === 'proposed' || state.status === 'active')
    && state.itemCount > 0;
}

async function cachedAutoPickup(deps: AutonomousWorkDispatchDeps, now: number): Promise<boolean> {
  if (deps.isAutoPickupBacklog) return deps.isAutoPickupBacklog();
  if (autoPickupCache && autoPickupCache.expiresAt > now) return autoPickupCache.value;
  const value = isFlywheelAutoPickupBacklog();
  autoPickupCache = { value, expiresAt: now + RELEASE_CONTEXT_CACHE_MS };
  return value;
}

async function cachedActiveBookIssues(
  projectRoot: string,
  deps: AutonomousWorkDispatchDeps,
  now: number,
): Promise<ReadonlySet<string>> {
  if (deps.activeBookIssues) return deps.activeBookIssues(projectRoot);
  const cached = activeBookCache.get(projectRoot);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await activeOrderBookIssues(projectRoot);
  activeBookCache.set(projectRoot, { value, expiresAt: now + RELEASE_CONTEXT_CACHE_MS });
  return value;
}

function emptyInput(labels: readonly string[] | null, planned = false): AutonomousWorkDispatchInput {
  return {
    labels,
    planned,
    autoPickupBacklog: false,
    activeBookMember: false,
    autoSpawnOnFinalizeConsent: false,
  };
}

export async function gatherAutonomousWorkDispatchInput(
  issueId: string,
  deps: AutonomousWorkDispatchDeps = {},
): Promise<AutonomousWorkDispatchInput> {
  const normalizedIssueId = issueId.trim().toUpperCase();
  let labels: readonly string[] | null = null;

  try {
    const issue = (deps.getIssues ?? getSharedIssues)()
      .find((candidate) => (
        typeof candidate['identifier'] === 'string'
        && candidate['identifier'].toUpperCase() === normalizedIssueId
      ));
    if (issue) {
      const rawLabels = Array.isArray(issue['labels']) ? issue['labels'] as unknown[] : [];
      labels = rawLabels
        .map((label) => (
          typeof label === 'string' ? label : ((label as { name?: string })?.name ?? '')
        ))
        .filter((label): label is string => Boolean(label));
    }
  } catch {
    // Autonomous dispatch fails closed when tracker labels cannot be read.
  }

  const labelDecision = decideAutonomousWorkDispatch({ ...emptyInput(labels, true) });
  if (!labelDecision.allow && labelDecision.code !== 'not-released') return emptyInput(labels);

  let project: ReturnType<typeof resolveProjectFromIssueSync> = null;
  let planned = deps.knownPlanned === true;
  if (!planned) {
    try {
      project = (deps.resolveProject ?? resolveProjectFromIssueSync)(normalizedIssueId);
      planned = Boolean(project && isPlannedState(
        await (deps.findPlannedState ?? defaultFindPlannedState)(project.projectPath, normalizedIssueId),
      ));
    } catch {
      planned = false;
    }
  }
  if (!planned) return emptyInput(labels);

  const normalizedLabels = new Set(labels?.map((label) => label.toLowerCase()));
  if (normalizedLabels.has(RELEASED_LABEL)) return emptyInput(labels, true);

  if (!project) {
    try {
      project = (deps.resolveProject ?? resolveProjectFromIssueSync)(normalizedIssueId);
    } catch {
      project = null;
    }
  }
  const now = (deps.now ?? Date.now)();
  const [autoPickupBacklog, activeIssues, autoSpawnOnFinalizeConsent] = await Promise.all([
    cachedAutoPickup(deps, now).catch(() => false),
    project ? cachedActiveBookIssues(project.projectPath, deps, now).catch(() => new Set<string>()) : new Set<string>(),
    Promise.resolve((deps.readAutoSpawnConsent ?? readAutoSpawnOnFinalizeFlagAsync)(normalizedIssueId)).catch(() => false),
  ]);

  return {
    labels,
    planned: true,
    autoPickupBacklog,
    activeBookMember: activeIssues.has(normalizedIssueId),
    autoSpawnOnFinalizeConsent,
  };
}

export function decideAutonomousWorkDispatch(
  input: AutonomousWorkDispatchInput,
): AutonomousWorkDispatchDecision {
  if (input.labels === null) {
    return {
      allow: false,
      code: 'labels-unavailable',
      reason:
        'Autonomous work dispatch was refused because tracker labels are unavailable, so ready, released, parked, vetoed, objection, and epic state cannot be verified. Restore label access or run pan start manually.',
    };
  }

  const labels = new Set(input.labels.map((label) => label.toLowerCase()));
  const hasLabel = (label: string): boolean => labels.has(label);

  if (hasLabel(PARKED_LABEL) || LEGACY_PARKED_LABELS.some(hasLabel)) {
    return {
      allow: false,
      code: 'parked',
      reason:
        'Autonomous work dispatch was refused because the issue is parked. Remove the parked label before allowing autonomous work, or run pan start manually.',
    };
  }

  if (hasLabel(VETOED_LABEL)) {
    return {
      allow: false,
      code: 'vetoed',
      reason:
        'Autonomous work dispatch was refused because the issue is vetoed. Remove the veto before allowing autonomous work, or run pan start manually.',
    };
  }

  if (hasLabel(OBJECTION_LABEL)) {
    return {
      allow: false,
      code: 'objection',
      reason:
        'Autonomous work dispatch was refused because the issue has an open objection. Resolve the objection before allowing autonomous work, or run pan start manually.',
    };
  }

  if (hasLabel(EPIC_LABEL)) {
    return {
      allow: false,
      code: 'epic',
      reason:
        'Autonomous work dispatch was refused because the issue is an epic container. Start one of its child issues instead.',
    };
  }

  if (!hasLabel(READY_LABEL)) {
    return {
      allow: false,
      code: 'not-ready',
      reason:
        'Autonomous work dispatch was refused because the issue is not ready. Add the ready label before allowing autonomous work, or run pan start manually.',
    };
  }

  if (!input.planned) {
    return {
      allow: false,
      code: 'not-planned',
      reason:
        'Autonomous work dispatch was refused because no active implementation plan with work items is available. Complete planning or run pan start manually.',
    };
  }

  const releaseSource: AutonomousWorkReleaseSource | null = hasLabel(RELEASED_LABEL)
    ? 'released-label'
    : input.autoPickupBacklog
      ? 'auto-pickup'
      : input.activeBookMember
        ? 'active-order-book'
        : input.autoSpawnOnFinalizeConsent
          ? 'planning-consent'
          : null;
  if (!releaseSource) {
    return {
      allow: false,
      code: 'not-released',
      reason:
        'Autonomous work dispatch was refused because the issue is not released and no release override applies. Add the released label, enable auto-pickup, include the issue in the active order book, or launch planning with auto-start; alternatively, run pan start manually.',
    };
  }

  return { allow: true, releaseSource };
}
