import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getCanonicalOverdeckHome, getOverdeckHome } from '../paths.js';

export type TelemetryAutoExclusion = 'ci' | 'temporary_home';

export interface TelemetryEnvironmentInputs {
  env: NodeJS.ProcessEnv;
  overdeckHome: string;
  temporaryRoots: readonly string[];
  realpath: (path: string) => string;
}

function defaultInputs(): TelemetryEnvironmentInputs {
  const temporaryRoots = [tmpdir(), join(getCanonicalOverdeckHome(), 'tmp')];
  if (process.platform !== 'win32') temporaryRoots.push('/tmp');
  return {
    env: process.env,
    overdeckHome: getOverdeckHome(),
    temporaryRoots,
    realpath: realpathSync,
  };
}

function isTruthyFlag(value: string | undefined): boolean {
  const trimmed = value?.trim().toLowerCase();
  return trimmed === '1' || trimmed === 'true';
}

/** PAN-5084: OVERDECK_TELEMETRY=1/true overrides every automatic exclusion. */
export function telemetryEnvironmentForcesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyFlag(env.OVERDECK_TELEMETRY);
}

function isCi(env: NodeJS.ProcessEnv): boolean {
  const trimmed = env.CI?.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  return lowered !== '0' && lowered !== 'false';
}

function resolveWithRealpath(inputs: TelemetryEnvironmentInputs, path: string): string {
  const resolved = resolve(path);
  try {
    return inputs.realpath(resolved);
  } catch {
    return resolved;
  }
}

/**
 * `rel === ''` means `home` and `root` are the same path. A bare
 * `rel.startsWith('..')` would also exclude a child directory named like
 * `..smoke-123`, so containment is checked against `'..' + sep` instead.
 */
function isInside(root: string, home: string): boolean {
  const rel = relative(root, home);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

function isTemporaryHome(inputs: TelemetryEnvironmentInputs): boolean {
  const home = resolveWithRealpath(inputs, inputs.overdeckHome);
  return inputs.temporaryRoots.some((root) => isInside(resolveWithRealpath(inputs, root), home));
}

/** PAN-5084: detect CI runs and temporary (test/throwaway) homes so they are excluded by default. */
export function detectTelemetryAutoExclusion(
  inputs: TelemetryEnvironmentInputs = defaultInputs(),
): TelemetryAutoExclusion | null {
  if (isCi(inputs.env)) return 'ci';
  if (isTemporaryHome(inputs)) return 'temporary_home';
  return null;
}
