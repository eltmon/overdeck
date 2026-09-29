/**
 * Aggregates everything the dashboard banner, `pan doctor`, and the
 * `/api/claude-code/status` route need about the launch binary, its install
 * method and upgrade plan, configured-model requirements, and shadow
 * binaries on PATH (PAN-4359).
 */

import { realpath } from 'node:fs/promises';
import { loadConfigSync } from '../config-yaml.js';
import type { NormalizedConfig } from '../config-yaml/schema.js';
import { resolveHarnessBinary } from '../harness-binary.js';
import { evaluateClaudeCodeRequirements, listConfiguredModels, type ClaudeCodeRequirement } from './requirements.js';
import {
  claudeCodeUpgradePlan,
  detectClaudeInstall,
  listClaudeBinariesOnPath,
  readClaudeCodeVersion,
  type ClaudeInstall,
  type ClaudeUpgradePlan,
} from './version.js';

export interface ClaudeCodeShadowBinary {
  readonly path: string;
  readonly realPath: string;
  readonly version: string | null;
}

export interface ClaudeCodeStatus {
  readonly found: boolean;
  readonly binaryPath: string | null;
  readonly version: string | null;
  readonly install: ClaudeInstall | null;
  readonly upgrade: ClaudeUpgradePlan | null;
  readonly requirements: ClaudeCodeRequirement[];
  /** true when any requirement.satisfied === false */
  readonly outdated: boolean;
  readonly shadows: ClaudeCodeShadowBinary[];
  readonly checkedAt: string;
}

export interface ClaudeCodeStatusDeps {
  readonly resolveBinary: () => Promise<string | null>;
  readonly readVersion: typeof readClaudeCodeVersion;
  readonly loadConfig: () => Pick<NormalizedConfig, 'roles' | 'workhorses' | 'tieredExecution' | 'defaultConversationModel'>;
  readonly listBinaries: typeof listClaudeBinariesOnPath;
  readonly upgradePlan: typeof claudeCodeUpgradePlan;
  readonly detectInstall: typeof detectClaudeInstall;
  readonly resolveRealPath: (path: string) => Promise<string>;
}

/**
 * Not found (`found: false`) is a valid, non-outdated state — no launch binary
 * means nothing has been proven too old. Shadows exclude the launch binary's
 * own real path, so a single install reports no shadows.
 */
export async function getClaudeCodeStatus(
  opts: { refresh?: boolean } = {},
  deps: Partial<ClaudeCodeStatusDeps> = {},
): Promise<ClaudeCodeStatus> {
  const resolveBinary = deps.resolveBinary ?? (() => resolveHarnessBinary('claude-code'));
  const readVersion = deps.readVersion ?? readClaudeCodeVersion;
  const loadConfig = deps.loadConfig ?? (() => loadConfigSync().config);
  const listBinaries = deps.listBinaries ?? listClaudeBinariesOnPath;
  const upgradePlan = deps.upgradePlan ?? claudeCodeUpgradePlan;
  const detectInstall = deps.detectInstall ?? detectClaudeInstall;
  const resolveRealPath = deps.resolveRealPath ?? realpath;

  const checkedAt = new Date().toISOString();
  const binaryPath = await resolveBinary();

  if (!binaryPath) {
    return {
      found: false,
      binaryPath: null,
      version: null,
      install: null,
      upgrade: null,
      requirements: [],
      outdated: false,
      shadows: [],
      checkedAt,
    };
  }

  const version = await readVersion(binaryPath, { refresh: opts.refresh });

  let realBinaryPath: string;
  try {
    realBinaryPath = await resolveRealPath(binaryPath);
  } catch {
    realBinaryPath = binaryPath;
  }

  const install = detectInstall(realBinaryPath);
  const upgrade = await upgradePlan(install);

  const requirements = evaluateClaudeCodeRequirements(version, listConfiguredModels(loadConfig()));
  const outdated = requirements.some((requirement) => requirement.satisfied === false);

  const shadows: ClaudeCodeShadowBinary[] = [];
  for (const binary of await listBinaries()) {
    if (binary.realPath === realBinaryPath) continue;
    shadows.push({
      path: binary.path,
      realPath: binary.realPath,
      version: await readVersion(binary.path, { refresh: opts.refresh }),
    });
  }

  return { found: true, binaryPath, version, install, upgrade, requirements, outdated, shadows, checkedAt };
}
