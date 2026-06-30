import type { ModelId } from '../settings.js';
import type { Role } from '../agents.js';
import { getModelEffortLevelsSync, resolveModelIdSync } from '../model-capabilities.js';
import { derivePercentPick, pickPercentModelRef, representativeModelRef } from './percent.js';
import {
  PARENT_MODEL_REF,
  ROLE_EFFORTS,
  WORKHORSE_SLOTS,
  type ModelRef,
  type NormalizedConfig,
  type RoleConfig,
  type RolesConfig,
  type WorkhorseSlot,
  type WorkhorsesConfig,
  type YamlConfig,
} from './schema.js';

export const DEFAULT_MODEL_REFS: Record<Role, ModelRef> = {
  plan: 'workhorse:expensive',
  work: 'workhorse:mid',
  review: 'workhorse:expensive',
  test: 'workhorse:mid',
  ship: 'workhorse:mid',
  flywheel: 'claude-opus-4-8',
  // Strike merges directly to main — precision matters, so default to the
  // expensive workhorse slot (same as plan/review).
  strike: 'workhorse:expensive',
  sequencer: 'workhorse:expensive',
};

export const DEFAULT_WORKHORSES: Required<WorkhorsesConfig> = {
  expensive: 'claude-opus-4-8',
  mid: 'claude-sonnet-5',
  cheap: 'claude-haiku-4-5',
};

export const DEFAULT_ROLES: Record<Role, RoleConfig> = {
  plan: { model: 'workhorse:expensive' },
  work: {
    model: 'workhorse:mid',
    sub: {
      inspect: { model: 'workhorse:cheap' },
      'inspect-deep': { model: 'workhorse:mid' },
    },
  },
  review: {
    model: 'workhorse:expensive',
    mode: 'quick',
    sub: {
      security: { model: 'workhorse:expensive' },
      correctness: { model: 'workhorse:mid' },
      performance: { model: 'workhorse:mid' },
      requirements: { model: 'workhorse:mid' },
      synthesis: { model: 'workhorse:expensive' },
    },
  },
  test: { model: 'workhorse:mid' },
  ship: { model: 'workhorse:mid' },
  // Strike (precision-merge-to-main role) — defaults to the expensive workhorse
  // slot because strike skips the normal review pipeline and lands directly.
  strike: { model: 'workhorse:expensive' },
  sequencer: { model: 'workhorse:expensive' },
  flywheel: {
    model: 'claude-opus-4-8',
    effort: 'high',
    minAgents: 20,
    maxAgents: 30,
    scope: 'pan-only',
  },
};

export function cloneRoles(roles: RolesConfig): RolesConfig {
  const cloned: RolesConfig = {};
  for (const [role, roleConfig] of Object.entries(roles) as Array<[Role, RoleConfig]>) {
    cloned[role] = {
      ...roleConfig,
      // Shallow-clone the distribution array so later mutations can't alias the cloned config.
      model: Array.isArray(roleConfig.model) ? [...roleConfig.model] : roleConfig.model,
      sub: roleConfig.sub ? { ...roleConfig.sub } : undefined,
    };
  }
  return cloned;
}

function isWorkhorseRef(ref: ModelRef): boolean {
  return ref.startsWith('workhorse:');
}

function workhorseSlotFromRef(ref: ModelRef): WorkhorseSlot | string {
  return ref.slice('workhorse:'.length);
}

export function derefWorkhorse(
  ref: ModelRef,
  config: Pick<NormalizedConfig, 'workhorses'>,
  fieldPath = 'model',
): ModelId {
  if (ref === PARENT_MODEL_REF) {
    throw new Error(`config.yaml: ${fieldPath} cannot be ${PARENT_MODEL_REF}; ${PARENT_MODEL_REF} is a resolve-only sub-role sentinel`);
  }
  if (!isWorkhorseRef(ref)) return resolveModelIdSync(ref) as ModelId;

  const slot = workhorseSlotFromRef(ref) as WorkhorseSlot;
  const resolved = config.workhorses?.[slot];
  if (!resolved) {
    throw new Error(`config.yaml: ${fieldPath} references ${ref} but workhorses.${slot} is not defined`);
  }
  if (isWorkhorseRef(resolved)) {
    throw new Error(`config.yaml: workhorses.${slot} cannot reference another workhorse`);
  }
  return resolveModelIdSync(resolved) as ModelId;
}

export function resolveModel(
  role: Role,
  subRole?: string,
  config: Pick<NormalizedConfig, 'roles' | 'workhorses'> = {},
  spawnKey?: string,
): ModelId {
  const roleConfig = config.roles?.[role];
  const rawSubModel = subRole ? roleConfig?.sub?.[subRole]?.model : undefined;
  const subModel = rawSubModel === PARENT_MODEL_REF ? undefined : rawSubModel;
  const roleModel = roleConfig?.model;

  // Sub-role model takes precedence; never sample the parent distribution for a sub-role.
  if (subModel) {
    const fieldPath = `roles.${role}.sub.${subRole}.model`;
    return derefWorkhorse(subModel, config, fieldPath);
  }

  if (Array.isArray(roleModel)) {
    const picked = spawnKey
      ? pickPercentModelRef(roleModel, spawnKey)
      : representativeModelRef(roleModel);
    return derefWorkhorse(picked, config, `roles.${role}.model`);
  }

  const scalarRef = roleModel ?? DEFAULT_MODEL_REFS[role];
  const fieldPath = roleModel ? `roles.${role}.model` : `defaults.${role}.model`;
  return derefWorkhorse(scalarRef, config, fieldPath);
}

/** One row of a model-origin distribution: a dereffed model with its bucket band and chosen flag. */
export interface ModelOriginEntry {
  /** The actual model id (workhorse refs already dereffed for display). */
  model: ModelId;
  /** This entry's weight (a percentage when the distribution totals 100). */
  weight: number;
  /** Bucket-band start (integer, inclusive). */
  lo: number;
  /** Bucket-band end (integer, exclusive). */
  hi: number;
  /** True for the entry the spawn key's bucket selected. */
  chosen: boolean;
}

/**
 * Read-only explanation of which model a percentage-role agent resolves to and why:
 * the spawn key, the deterministic bucket, and the percent bands. Surfaced in the
 * dashboard right-click MODEL inspector (PAN-2053). `null` for scalar/single-model roles.
 */
export interface ModelOriginData {
  /** The exact spawn key whose bucket selected the model (`${role}:${issueId}`). */
  spawnKey: string;
  /** The chosen model id (dereffed) — equals what determineModel produced for this key. */
  resolved: ModelId;
  /** Deterministic bucket for this key, in [0, total). */
  bucket: number;
  /** Number of buckets = sum of weights (100 when the distribution is percentages). */
  total: number;
  /** Every distribution entry, dereffed, with its bucket band and the chosen flag. */
  distribution: ModelOriginEntry[];
}

/**
 * Explain which model a `role` agent drew from its role's percentage distribution,
 * and why, given the EXACT `spawnKey` the agent spawned with. Returns `null` when
 * the role uses a scalar model (nothing to explain) — the caller should then just
 * show the resolved model with no bars/bucket.
 *
 * Faithfulness: `spawnKey` must be the real key persisted on the agent's state at
 * spawn (`AgentState.modelSpawnKey`), not a guess — the bucket is sensitive to its
 * exact form (e.g. issue-id casing). Read-only: never mutates anything.
 *
 * The distribution is read from the LIVE config (an operator edit since spawn is
 * reflected); the resolved model still derives from the same key, so the highlighted
 * band stays internally consistent with `resolved`.
 */
export function computeModelOrigin(
  role: Role,
  spawnKey: string,
  config: Pick<NormalizedConfig, 'roles' | 'workhorses'>,
): ModelOriginData | null {
  const roleModel = config.roles?.[role]?.model;
  if (!Array.isArray(roleModel)) return null;

  const pick = derivePercentPick(roleModel, spawnKey);
  const fieldPath = `roles.${role}.model`;
  const distribution: ModelOriginEntry[] = pick.bands.map((b) => ({
    model: derefWorkhorse(b.model, config, fieldPath),
    weight: b.weight,
    lo: b.lo,
    hi: b.hi,
    chosen: b.chosen,
  }));
  return {
    spawnKey,
    resolved: derefWorkhorse(pick.chosen, config, fieldPath),
    bucket: pick.bucket,
    total: pick.total,
    distribution,
  };
}

export function mergeRoleConfig(result: NormalizedConfig, config: YamlConfig | null): void {
  if (!config?.workhorses && !config?.roles) return;

  if (config.workhorses) {
    // PAN-1048 review feedback 003 (REQ-18): reject any workhorse key outside
    // the canonical three slots (expensive | mid | cheap). The Settings API
    // already gates this on the HTTP path; the config-load path was silently
    // accepting hand-edited config.yaml values like workhorses.tiny: claude-…
    // and propagating them into the merged registry, where derefWorkhorse()
    // would later miss because the role config only references the canonical
    // slots. Failing fast at load time gives a precise field error instead.
    const unknownSlots = Object.keys(config.workhorses).filter(
      (slot): slot is string => !(WORKHORSE_SLOTS as readonly string[]).includes(slot),
    );
    if (unknownSlots.length > 0) {
      throw new Error(
        `config.yaml: unknown workhorse slot${unknownSlots.length > 1 ? 's' : ''} ` +
          unknownSlots.map((s) => `workhorses.${s}`).join(', ') +
          `. Valid slots: ${WORKHORSE_SLOTS.join(', ')}.`,
      );
    }
    result.workhorses = {
      ...(result.workhorses ?? {}),
      ...config.workhorses,
    };
  }

  if (config.roles) {
    result.roles = { ...(result.roles ?? {}) };
    for (const [role, roleConfig] of Object.entries(config.roles) as Array<[Role, RoleConfig]>) {
      const existing = result.roles[role];
      const sub = {
        ...(existing?.sub ?? {}),
        ...(roleConfig.sub ?? {}),
      };
      const mergedRoleConfig = {
        ...existing,
        ...roleConfig,
        sub: Object.keys(sub).length > 0 ? sub : undefined,
      };
      if (
        roleConfig.maxAgents !== undefined &&
        roleConfig.minAgents === undefined &&
        mergedRoleConfig.minAgents !== undefined &&
        mergedRoleConfig.minAgents > roleConfig.maxAgents
      ) {
        mergedRoleConfig.minAgents = roleConfig.maxAgents;
      }
      result.roles[role] = mergedRoleConfig;
    }
  }
}

function validateRoleFields(role: Role, roleConfig: RoleConfig): void {
  if (Array.isArray(roleConfig.model)) {
    if (roleConfig.model.length === 0) {
      throw new Error(`config.yaml: roles.${role}.model distribution must be a non-empty array`);
    }
    for (let i = 0; i < roleConfig.model.length; i++) {
      const entry = roleConfig.model[i];
      if (!entry.model || typeof entry.model !== 'string') {
        throw new Error(`config.yaml: roles.${role}.model[${i}].model must be a non-empty string`);
      }
      if (!Number.isInteger(entry.weight) || entry.weight <= 0) {
        throw new Error(`config.yaml: roles.${role}.model[${i}].weight must be a positive integer`);
      }
    }
  }
  if (roleConfig.harness !== undefined && roleConfig.harness !== 'claude-code' && roleConfig.harness !== 'ohmypi' && roleConfig.harness !== 'codex') {
    throw new Error(`config.yaml: roles.${role}.harness must be claude-code, ohmypi, or codex`);
  }
  if (roleConfig.effort !== undefined && !ROLE_EFFORTS.includes(roleConfig.effort)) {
    throw new Error(`config.yaml: roles.${role}.effort must be one of ${ROLE_EFFORTS.join(', ')}`);
  }
  if (roleConfig.mode !== undefined && roleConfig.mode !== 'quick' && roleConfig.mode !== 'full') {
    throw new Error(`config.yaml: roles.${role}.mode must be quick or full`);
  }
  if (roleConfig.maxAgents !== undefined && (!Number.isInteger(roleConfig.maxAgents) || roleConfig.maxAgents < 1)) {
    throw new Error(`config.yaml: roles.${role}.maxAgents must be a positive integer`);
  }
  if (roleConfig.minAgents !== undefined && (!Number.isInteger(roleConfig.minAgents) || roleConfig.minAgents < 0)) {
    throw new Error(`config.yaml: roles.${role}.minAgents must be a non-negative integer`);
  }
  if (
    roleConfig.minAgents !== undefined &&
    roleConfig.maxAgents !== undefined &&
    roleConfig.minAgents > roleConfig.maxAgents
  ) {
    throw new Error(`config.yaml: roles.${role}.minAgents (${roleConfig.minAgents}) cannot exceed maxAgents (${roleConfig.maxAgents})`);
  }
  if (roleConfig.scope !== undefined && roleConfig.scope !== 'pan-only' && roleConfig.scope !== 'all-tracked-projects') {
    throw new Error(`config.yaml: roles.${role}.scope must be pan-only or all-tracked-projects`);
  }
}

export function validateRoleModelRefs(config: NormalizedConfig): void {
  for (const [slot, ref] of Object.entries(config.workhorses ?? {}) as Array<[WorkhorseSlot, ModelRef]>) {
    if (ref === PARENT_MODEL_REF) {
      throw new Error(`config.yaml: workhorses.${slot} cannot be ${PARENT_MODEL_REF}; ${PARENT_MODEL_REF} is valid only for sub-role models`);
    }
    if (isWorkhorseRef(ref)) {
      throw new Error(`config.yaml: workhorses.${slot} cannot reference another workhorse`);
    }
    resolveModelIdSync(ref);
  }

  for (const [role, roleConfig] of Object.entries(config.roles ?? {}) as Array<[Role, RoleConfig]>) {
    validateRoleFields(role, roleConfig);
    if (Array.isArray(roleConfig.model)) {
      // Validate each distribution entry's model ref is resolvable.
      for (let i = 0; i < roleConfig.model.length; i++) {
        derefWorkhorse(roleConfig.model[i].model, config, `roles.${role}.model[${i}].model`);
      }
    } else if (roleConfig.model) {
      const resolvedModel = derefWorkhorse(roleConfig.model, config, `roles.${role}.model`);
      if (roleConfig.effort !== undefined) {
        const supported = getModelEffortLevelsSync(resolvedModel);
        if (supported !== undefined && !supported.includes(roleConfig.effort)) {
          throw new Error(
            `config.yaml: roles.${role}.effort '${roleConfig.effort}' is not supported by ${resolvedModel} (supported: ${supported.join(', ')})`,
          );
        }
      }
    }
    for (const [subRole, subConfig] of Object.entries(roleConfig.sub ?? {})) {
      if (subConfig.model && subConfig.model !== PARENT_MODEL_REF) {
        derefWorkhorse(subConfig.model, config, `roles.${role}.sub.${subRole}.model`);
      }
    }
  }
}
