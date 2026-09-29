/**
 * Claude Code version requirements: which configured models need a minimum
 * Claude Code version, whether the launch binary meets it, and the refusal
 * raised by `prepareHarnessLaunch` when it does not (PAN-4359).
 */

import { realpath } from 'node:fs/promises';
import { PARENT_MODEL_REF, WORKHORSE_SLOTS, type NormalizedConfig, type Role } from '../config-yaml/schema.js';
import { DEFAULT_MODEL_REFS, derefWorkhorse } from '../config-yaml/roles.js';
import { compareSemver } from '../herdr-setup/binary.js';
import { MODEL_CAPABILITIES, resolveModelId } from '../model-capabilities.js';
import type { ModelId } from '../settings.js';
import { claudeCodeUpgradePlan, detectClaudeInstall, readClaudeCodeVersion } from './version.js';

/** Every role whose configured model(s) may need a Claude Code minimum (WI-3). */
const CONFIGURED_ROLES: readonly Role[] = [
  'plan',
  'work',
  'review',
  'test',
  'ship',
  'flywheel',
  'strike',
  'sequencer',
  'knowledge',
  'worker',
];

/** Strips a trailing `[...]` context suffix (e.g. `claude-sonnet-5-5[1m]`) before resolving. */
function stripContextSuffix(model: string): string {
  return model.replace(/\[[^\]]*\]$/, '');
}

/** The oldest Claude Code CLI that recognizes `model`, or undefined when none is documented. */
export function minClaudeCodeVersionFor(model: string): string | undefined {
  const resolved = resolveModelId(stripContextSuffix(model));
  return MODEL_CAPABILITIES[resolved as ModelId]?.minClaudeCodeVersion;
}

function displayNameFor(model: string): string {
  const resolved = resolveModelId(stripContextSuffix(model));
  return MODEL_CAPABILITIES[resolved as ModelId]?.displayName ?? model;
}

export interface ConfiguredModel {
  readonly model: string;
  readonly sources: string[];
}

/**
 * Every model id the operator's config (with defaults applied) can launch:
 * role models — including each weighted-distribution entry and every
 * sub-role — workhorse slots, enabled tiered-execution tier models, and the
 * default conversation model. Workhorse refs are dereffed; an entry whose
 * deref fails (e.g. a dangling `workhorse:` reference) is skipped rather than
 * thrown. Duplicate models merge their sources.
 */
export function listConfiguredModels(
  config: Pick<NormalizedConfig, 'roles' | 'workhorses' | 'tieredExecution' | 'defaultConversationModel'>,
): ConfiguredModel[] {
  const sourcesByModel = new Map<string, string[]>();

  const record = (model: string, source: string): void => {
    const sources = sourcesByModel.get(model);
    if (sources) {
      if (!sources.includes(source)) sources.push(source);
    } else {
      sourcesByModel.set(model, [source]);
    }
  };

  const derefAndRecord = (ref: string, source: string): void => {
    try {
      record(derefWorkhorse(ref, config, source), source);
    } catch {
      // Dangling or invalid reference — not launchable, so not a requirement source.
    }
  };

  for (const role of CONFIGURED_ROLES) {
    const roleConfig = config.roles?.[role];
    const roleModel = roleConfig?.model;
    const fieldPath = `roles.${role}.model`;

    if (Array.isArray(roleModel)) {
      for (const entry of roleModel) derefAndRecord(entry.model, fieldPath);
    } else if (roleModel) {
      derefAndRecord(roleModel, fieldPath);
    } else {
      derefAndRecord(DEFAULT_MODEL_REFS[role], `defaults.${role}.model`);
    }

    for (const [subName, subConfig] of Object.entries(roleConfig?.sub ?? {})) {
      if (subConfig.model === PARENT_MODEL_REF) continue;
      derefAndRecord(subConfig.model, `roles.${role}.sub.${subName}.model`);
    }
  }

  for (const slot of WORKHORSE_SLOTS) {
    const value = config.workhorses?.[slot];
    if (value) derefAndRecord(value, `workhorses.${slot}`);
  }

  if (config.tieredExecution?.enabled) {
    for (const [name, tier] of Object.entries(config.tieredExecution.tiers ?? {})) {
      record(resolveModelId(tier.model), `tieredExecution.tiers.${name}.model`);
    }
  }

  if (config.defaultConversationModel) {
    record(resolveModelId(config.defaultConversationModel), 'models.default_conversation_model');
  }

  return Array.from(sourcesByModel.entries()).map(([model, sources]) => ({ model, sources }));
}

export interface ClaudeCodeRequirement {
  readonly model: string;
  readonly displayName: string;
  readonly minVersion: string;
  readonly sources: string[];
  /** null when the installed version could not be read. */
  readonly satisfied: boolean | null;
}

/** Only the configured models that document a minimum Claude Code version. */
export function evaluateClaudeCodeRequirements(
  installed: string | null,
  models: ConfiguredModel[],
): ClaudeCodeRequirement[] {
  const requirements: ClaudeCodeRequirement[] = [];
  for (const { model, sources } of models) {
    const minVersion = minClaudeCodeVersionFor(model);
    if (!minVersion) continue;
    requirements.push({
      model,
      displayName: displayNameFor(model),
      minVersion,
      sources,
      satisfied: installed === null ? null : compareSemver(installed, minVersion) >= 0,
    });
  }
  return requirements;
}

export interface ClaudeCodeTooOldErrorArgs {
  readonly model: string;
  readonly displayName: string;
  readonly installed: string;
  readonly required: string;
  readonly binaryPath: string;
  readonly upgradeCommand: string;
}

/** The exact refusal text `prepareHarnessLaunch` throws (PAN-4359 FR-6). */
export function formatClaudeCodeTooOldMessage(args: ClaudeCodeTooOldErrorArgs): string {
  return (
    `${args.displayName} (${args.model}) needs Claude Code ${args.required} or newer, but Overdeck would launch ` +
    `Claude Code ${args.installed} at ${args.binaryPath}. Upgrade it with \`${args.upgradeCommand}\` (or the ` +
    `Upgrade Claude Code button in the dashboard), then launch again. Running sessions keep their current Claude ` +
    `Code. No terminal session was created.`
  );
}

export class ClaudeCodeTooOldError extends Error {
  readonly model: string;
  readonly installed: string;
  readonly required: string;
  readonly binaryPath: string;
  readonly upgradeCommand: string;

  constructor(args: ClaudeCodeTooOldErrorArgs) {
    super(formatClaudeCodeTooOldMessage(args));
    this.name = 'ClaudeCodeTooOldError';
    this.model = args.model;
    this.installed = args.installed;
    this.required = args.required;
    this.binaryPath = args.binaryPath;
    this.upgradeCommand = args.upgradeCommand;
  }
}

export interface AssertClaudeCodeSupportsModelDeps {
  readonly readVersion?: typeof readClaudeCodeVersion;
  readonly detectInstall?: typeof detectClaudeInstall;
  readonly upgradePlan?: typeof claudeCodeUpgradePlan;
  readonly resolveRealPath?: (path: string) => Promise<string>;
}

/**
 * Refuses a `claude-code` launch whose model needs a newer Claude Code than
 * `binaryPath` (PAN-4359 D2). No model, no documented minimum, or an unreadable
 * version (D3) all let the launch proceed — an unreadable version only warns.
 */
export async function assertClaudeCodeSupportsModel(
  binaryPath: string,
  model: string | undefined,
  deps: AssertClaudeCodeSupportsModelDeps = {},
): Promise<void> {
  if (!model) return;

  const required = minClaudeCodeVersionFor(model);
  if (!required) return;

  const readVersion = deps.readVersion ?? readClaudeCodeVersion;
  const installed = await readVersion(binaryPath);
  if (installed === null) {
    console.warn(
      `[claude-code] could not read the version of ${binaryPath}; skipping the minimum-version check for ${model}`,
    );
    return;
  }

  if (compareSemver(installed, required) >= 0) return;

  const resolveRealPath = deps.resolveRealPath ?? realpath;
  const detectInstall = deps.detectInstall ?? detectClaudeInstall;
  const upgradePlan = deps.upgradePlan ?? claudeCodeUpgradePlan;

  let realBinaryPath: string;
  try {
    realBinaryPath = await resolveRealPath(binaryPath);
  } catch {
    realBinaryPath = binaryPath;
  }

  const install = detectInstall(realBinaryPath);
  const plan = await upgradePlan(install);

  throw new ClaudeCodeTooOldError({
    model,
    displayName: displayNameFor(model),
    installed,
    required,
    binaryPath,
    upgradeCommand: plan.display,
  });
}
