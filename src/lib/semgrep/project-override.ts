/**
 * Per-project `verification.sast` setter and view (PAN-4594, FR-4). Built on
 * `updateProjectsConfigAsync` (src/lib/projects.ts); never edits src/lib/projects.ts
 * itself (D10 — it is already at its file-size allowlist cap).
 */
import { resolveSastGateMode } from '../cloister/sast-gate.js';
import type { NormalizedSemgrepConfig, SemgrepGateMode } from '../config-yaml/semgrep.js';
import { SEMGREP_GATE_MODES } from '../config-yaml/semgrep.js';
import { updateProjectsConfigAsync, type ProjectConfig, type ProjectsConfig, type ProjectsConfigMutation } from '../projects.js';

export interface ProjectSastView {
  /** projects.yaml verification.sast, or null when unset. */
  value: SemgrepGateMode | null;
  /** resolveSastGateMode(...).mode */
  effective: SemgrepGateMode;
  reason: string;
  semgrepEnabled: boolean;
}

export function applyProjectSastOverride(
  config: ProjectsConfig,
  key: string,
  value: SemgrepGateMode | null,
): ProjectsConfigMutation<void> {
  const project = config.projects[key];
  if (!project) throw new Error(`Unknown project: ${key}`);
  if ((project.verification?.sast ?? null) === value) {
    return { config, result: undefined, changed: false };
  }
  const updated: ProjectConfig = { ...project };
  if (value === null) {
    const { sast: _sast, ...rest } = project.verification ?? {};
    if (Object.keys(rest).length === 0) delete updated.verification;
    else updated.verification = rest;
  } else {
    updated.verification = { ...project.verification, sast: value };
  }
  config.projects[key] = updated;
  return { config, result: undefined, changed: true };
}

export async function setProjectSastOverride(key: string, value: SemgrepGateMode | null): Promise<void> {
  await updateProjectsConfigAsync((config) => applyProjectSastOverride(config, key, value));
}

export function projectSastView(
  project: ProjectConfig,
  semgrep: Pick<NormalizedSemgrepConfig, 'enabled' | 'gate'>,
): ProjectSastView {
  const raw = project.verification?.sast;
  const value = typeof raw === 'string' && (SEMGREP_GATE_MODES as readonly string[]).includes(raw) ? raw : null;
  const decision = resolveSastGateMode(semgrep, project.verification?.sast, () => {});
  return { value, effective: decision.mode, reason: decision.reason, semgrepEnabled: semgrep.enabled };
}
