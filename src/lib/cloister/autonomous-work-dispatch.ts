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
import { readAutoSpawnOnFinalizeFlag } from '../planning/spawn-planning-session.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { activeOrderBookIssues } from './flywheel.js';

export interface AutonomousWorkDispatchInput {
  labels: readonly string[] | null;
  autoPickupBacklog: boolean;
  activeBookMember: boolean;
  autoSpawnOnFinalizeConsent: boolean;
}

export interface AutonomousWorkDispatchDeps {
  getIssues?: () => Array<Record<string, unknown>>;
  isAutoPickupBacklog?: typeof isFlywheelAutoPickupBacklog;
  resolveProject?: typeof resolveProjectFromIssueSync;
  activeBookIssues?: typeof activeOrderBookIssues;
  readAutoSpawnConsent?: typeof readAutoSpawnOnFinalizeFlag;
}

export type AutonomousWorkDispatchDecision =
  | { allow: true }
  | {
      allow: false;
      code:
        | 'not-ready'
        | 'not-released'
        | 'parked'
        | 'vetoed'
        | 'objection'
        | 'epic'
        | 'labels-unavailable';
      reason: string;
    };

function getSharedIssues(): Array<Record<string, unknown>> {
  // Keep this lazy require aligned with autonomous-plan-dispatch: a static
  // import creates a lib → dashboard layering edge.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSharedIssueService } = require('../../dashboard/server/services/issue-service-singleton.js') as typeof import('../../dashboard/server/services/issue-service-singleton.js');
  return getSharedIssueService().getIssues() as Array<Record<string, unknown>>;
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

  let autoPickupBacklog = false;
  try {
    autoPickupBacklog = (deps.isAutoPickupBacklog ?? isFlywheelAutoPickupBacklog)();
  } catch {
    // The release override is absent when control settings cannot be read.
  }

  let activeBookMember = false;
  try {
    const project = (deps.resolveProject ?? resolveProjectFromIssueSync)(normalizedIssueId);
    if (project) {
      const activeIssues = await (deps.activeBookIssues ?? activeOrderBookIssues)(project.projectPath);
      activeBookMember = activeIssues.has(normalizedIssueId);
    }
  } catch {
    // The release override is absent when order-book state cannot be read.
  }

  let autoSpawnOnFinalizeConsent = false;
  try {
    autoSpawnOnFinalizeConsent = (deps.readAutoSpawnConsent ?? readAutoSpawnOnFinalizeFlag)(normalizedIssueId);
  } catch {
    // The explicit launch consent is absent when its flag cannot be read.
  }

  return {
    labels,
    autoPickupBacklog,
    activeBookMember,
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

  const released = hasLabel(RELEASED_LABEL)
    || input.autoPickupBacklog
    || input.activeBookMember
    || input.autoSpawnOnFinalizeConsent;
  if (!released) {
    return {
      allow: false,
      code: 'not-released',
      reason:
        'Autonomous work dispatch was refused because the issue is not released and no release override applies. Add the released label, enable auto-pickup, include the issue in the active order book, or launch planning with auto-start; alternatively, run pan start manually.',
    };
  }

  return { allow: true };
}
