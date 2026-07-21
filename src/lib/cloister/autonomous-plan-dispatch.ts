import { Effect } from 'effect';
import { getAgentState } from '../agents.js';
import {
  LEGACY_PARKED_LABELS,
  OBJECTION_LABEL,
  PARKED_LABEL,
  RELEASED_LABEL,
  VETOED_LABEL,
} from '../backlog/pickup.js';
import { derefWorkhorse, loadConfigSync, type NormalizedConfig } from '../config-yaml.js';
import { isFlywheelAutoPickupBacklog } from '../overdeck/control-settings.js';

export interface AutonomousPlanDispatchInput {
  autoPickupBacklog: boolean;
  labels: readonly string[] | null;
  recordedModel?: string;
  autonomousModel?: string;
  workhorses: NormalizedConfig['workhorses'];
}

export type AutonomousPlanDispatchDecision =
  | {
      allow: true;
      model: string;
      modelSource: 'recorded' | 'autonomousModel';
    }
  | {
      allow: false;
      code:
        | 'not-released'
        | 'parked'
        | 'vetoed'
        | 'objection'
        | 'labels-unavailable'
        | 'no-autonomous-model';
      reason: string;
    };

export async function gatherAutonomousPlanDispatchInput(
  issueId: string,
): Promise<AutonomousPlanDispatchInput> {
  const normalizedIssueId = issueId.trim().toUpperCase();
  const issueLower = normalizedIssueId.toLowerCase();
  let labels: readonly string[] | null = null;

  try {
    // Keep this lazy require aligned with buildClassifyLookups: a static import
    // creates a lib → dashboard layering edge.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSharedIssueService } = require('../../dashboard/server/services/issue-service-singleton.js') as typeof import('../../dashboard/server/services/issue-service-singleton.js');
    const issue = (getSharedIssueService().getIssues() as Array<Record<string, unknown>>)
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
    // The scheduler cannot prove blocker labels are absent without the issue service.
  }

  const currentState = await Effect.runPromise(getAgentState(`agent-${issueLower}-plan`));
  const legacyState = currentState?.model
    ? null
    : await Effect.runPromise(getAgentState(`planning-${issueLower}`));
  const config = loadConfigSync().config;

  return {
    autoPickupBacklog: isFlywheelAutoPickupBacklog(),
    labels,
    recordedModel: currentState?.model ?? legacyState?.model,
    autonomousModel: typeof config.roles?.plan?.autonomousModel === 'string'
      ? config.roles.plan.autonomousModel
      : undefined,
    workhorses: config.workhorses,
  };
}

export function decideAutonomousPlanDispatch(
  input: AutonomousPlanDispatchInput,
): AutonomousPlanDispatchDecision {
  if (input.labels === null) {
    return {
      allow: false,
      code: 'labels-unavailable',
      reason:
        'Autonomous planning dispatch was refused because tracker labels are unavailable, so parked, vetoed, and objection state cannot be verified. Restore label access or run pan plan manually.',
    };
  }

  const labels = new Set(input.labels.map((label) => label.toLowerCase()));
  const hasLabel = (label: string): boolean => labels.has(label);

  if (hasLabel(PARKED_LABEL) || LEGACY_PARKED_LABELS.some(hasLabel)) {
    return {
      allow: false,
      code: 'parked',
      reason:
        'Autonomous planning dispatch was refused because the issue is parked. Remove the parked label before releasing the issue or enabling auto-pickup, then set roles.plan.autonomousModel; alternatively, run pan plan manually.',
    };
  }

  if (hasLabel(VETOED_LABEL)) {
    return {
      allow: false,
      code: 'vetoed',
      reason:
        'Autonomous planning dispatch was refused because the issue is vetoed. Remove the veto before releasing the issue or enabling auto-pickup, then set roles.plan.autonomousModel; alternatively, run pan plan manually.',
    };
  }

  if (hasLabel(OBJECTION_LABEL)) {
    return {
      allow: false,
      code: 'objection',
      reason:
        'Autonomous planning dispatch was refused because the issue has an open objection. Resolve the objection before releasing the issue or enabling auto-pickup, then set roles.plan.autonomousModel; alternatively, run pan plan manually.',
    };
  }

  if (!input.autoPickupBacklog && !hasLabel(RELEASED_LABEL)) {
    return {
      allow: false,
      code: 'not-released',
      reason:
        'Autonomous planning dispatch was refused because the issue is not released and auto-pickup is disabled. Add the released label or enable auto-pickup, then set roles.plan.autonomousModel; alternatively, run pan plan manually.',
    };
  }

  if (input.recordedModel) {
    return {
      allow: true,
      model: input.recordedModel,
      modelSource: 'recorded',
    };
  }

  if (input.autonomousModel) {
    try {
      return {
        allow: true,
        model: derefWorkhorse(
          input.autonomousModel,
          { workhorses: input.workhorses },
          'roles.plan.autonomousModel',
        ),
        modelSource: 'autonomousModel',
      };
    } catch {
      // Invalid autonomous staffing is a policy refusal, not permission to fall
      // through to the normal plan-role model.
    }
  }

  return {
    allow: false,
    code: 'no-autonomous-model',
    reason:
      'Autonomous planning dispatch was refused because no recorded planning model or valid roles.plan.autonomousModel is available. Set roles.plan.autonomousModel or run pan plan manually; the issue must also be released or auto-pickup must be enabled for autonomous dispatch.',
  };
}
