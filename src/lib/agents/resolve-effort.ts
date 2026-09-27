/**
 * The single reasoning-effort resolver. Walks the full precedence chain
 * (explicit > item > plan > tier > sub-role > role > project > default) and
 * clamps the winning value through the effort-support leaf. Nothing in
 * config-yaml, settings-api or tier-table imports this module back — they
 * validate/clamp through ./effort-support.js instead, to avoid a cycle
 * through config-yaml.ts's re-export of config-yaml/roles.js.
 */
import { DEFAULT_EFFORT, isEffortLevel } from '@overdeck/contracts';
import type { EffortLevel, EffortSource } from '@overdeck/contracts';
import { clampEffort } from './effort-support.js';
import { loadConfigSync } from '../config-yaml.js';
import type { NormalizedConfig, Role } from '../config-yaml.js';
import { loadProjectsConfigSync, resolveProjectFromIssueSync } from '../projects.js';
import type { RuntimeName } from '../runtimes/types.js';

export class InvalidEffortError extends Error {
  constructor(public readonly value: unknown) {
    super(`Invalid effort level: ${JSON.stringify(value)}`);
    this.name = 'InvalidEffortError';
  }
}

/** The only slice of {@link NormalizedConfig} resolveEffort actually reads. */
export type EffortConfigSlice = Pick<NormalizedConfig, 'tieredExecution' | 'roles'>;

export interface ResolveEffortInput {
  /** Layer 1. Invalid values throw {@link InvalidEffortError}. */
  explicit?: unknown;
  /** Layer 2, an xBRIEF item's `metadata.effort`. Invalid values fall through silently. */
  itemEffort?: unknown;
  /** Layer 3, an xBRIEF plan's `metadata.effort`. Invalid values fall through silently. */
  planEffort?: unknown;
  /** Layer 4: reads `tiered_execution.tiers[tierName].effort` from config. */
  tierName?: string;
  /** Layer 5/6: reads `roles[role].sub[subRole].effort`, then `roles[role].effort`, from config. */
  role?: Role;
  subRole?: string;
  /** Layer 7: resolves the issue's project and reads `projects[key].effort`. Invalid values fall through with a warning. */
  issueId?: string;
  /** Used only to clamp the resolved level — never to select a layer. */
  model?: string;
  harness?: RuntimeName;
  /** Pre-loaded config, mainly for tests. Defaults to `loadConfigSync().config`. */
  config?: EffortConfigSlice;
}

export interface ResolvedEffort {
  /** The final, clamp-adjusted level. */
  effort: EffortLevel;
  /** Which precedence layer supplied {@link ResolvedEffort.requested}. */
  source: EffortSource;
  /** The level the precedence chain selected, before clamping. */
  requested: EffortLevel;
  clamped: boolean;
  warning?: string;
}

function projectEffort(issueId: string): { effort?: EffortLevel; warning?: string } {
  try {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return {};
    const projectConfig = loadProjectsConfigSync().projects[resolved.projectKey];
    const value = projectConfig?.effort;
    if (value === undefined) return {};
    if (isEffortLevel(value)) return { effort: value };
    return { warning: `Project '${resolved.projectKey}' has an invalid effort '${value}'; ignoring it.` };
  } catch {
    return {};
  }
}

/** Walks the precedence chain and clamps the result. Synchronous; spawns no child processes. */
export function resolveEffort(input: ResolveEffortInput): ResolvedEffort {
  if (input.explicit !== undefined) {
    if (!isEffortLevel(input.explicit)) {
      throw new InvalidEffortError(input.explicit);
    }
    return applyClamp(input.explicit, 'explicit', input);
  }

  if (isEffortLevel(input.itemEffort)) {
    return applyClamp(input.itemEffort, 'item', input);
  }

  if (isEffortLevel(input.planEffort)) {
    return applyClamp(input.planEffort, 'plan', input);
  }

  if (input.tierName || input.role) {
    const config = input.config ?? loadConfigSync().config;

    if (input.tierName) {
      const tierEffort = config.tieredExecution.tiers[input.tierName]?.effort;
      if (isEffortLevel(tierEffort)) {
        return applyClamp(tierEffort, 'tier', input);
      }
    }

    if (input.role) {
      if (input.subRole) {
        const subRoleEffort = config.roles?.[input.role]?.sub?.[input.subRole]?.effort;
        if (isEffortLevel(subRoleEffort)) {
          return applyClamp(subRoleEffort, 'sub-role', input);
        }
      }

      const roleEffort = config.roles?.[input.role]?.effort;
      if (isEffortLevel(roleEffort)) {
        return applyClamp(roleEffort, 'role', input);
      }
    }
  }

  let projectWarning: string | undefined;
  if (input.issueId) {
    const { effort, warning } = projectEffort(input.issueId);
    projectWarning = warning;
    if (effort !== undefined) {
      return applyClamp(effort, 'project', input, projectWarning);
    }
  }

  return applyClamp(DEFAULT_EFFORT, 'default', input, projectWarning);
}

function applyClamp(
  requested: EffortLevel,
  source: EffortSource,
  input: ResolveEffortInput,
  precedingWarning?: string,
): ResolvedEffort {
  const { effort, clamped, warning: clampWarning } = clampEffort(requested, input.model, input.harness);
  const warning = [precedingWarning, clampWarning].filter((part): part is string => Boolean(part)).join(' ') || undefined;
  return { effort, source, requested, clamped, warning };
}
