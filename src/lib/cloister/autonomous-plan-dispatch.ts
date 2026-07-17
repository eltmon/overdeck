import {
  LEGACY_PARKED_LABELS,
  OBJECTION_LABEL,
  PARKED_LABEL,
  RELEASED_LABEL,
  VETOED_LABEL,
} from '../backlog/pickup.js';
import { derefWorkhorse, type NormalizedConfig } from '../config-yaml.js';

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
