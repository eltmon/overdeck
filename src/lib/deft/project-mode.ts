/**
 * Deft managed mode (PAN-3943 WI-6): the operator's per-project decision
 * "Deft methodology on, Overdeck owns worktrees, review, merge, and the
 * pipeline xBRIEF", stored as `projects.<key>.deft_integration` in
 * projects.yaml.
 *
 * Only the decision is stored. Detection results are derived on every call
 * and never written here. This module does not detect or compare: the CLI
 * (`pan skills deft enable`) owns the Directive-project and plan gates.
 */
import { listProjectsAsync, updateProjectsConfigAsync, type ProjectConfig } from '../projects.js';

export interface DeftIntegration {
  mode: 'managed';
  /** sha256 hex of the collision report text the operator accepted. */
  plan_digest: string;
  enabled_at: string;
}

type ProjectWithDeftIntegration = ProjectConfig & { deft_integration?: unknown };

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function parseIntegration(value: unknown): DeftIntegration | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { mode, plan_digest, enabled_at } = value as Record<string, unknown>;
  if (mode !== 'managed' || typeof plan_digest !== 'string' || typeof enabled_at !== 'string') return null;
  return { mode, plan_digest, enabled_at };
}

export async function readDeftIntegration(projectKey: string): Promise<DeftIntegration | null> {
  const match = (await listProjectsAsync()).find((project) => project.key === projectKey);
  return parseIntegration((match?.config as ProjectWithDeftIntegration | undefined)?.deft_integration);
}

export async function enableDeftManaged(projectKey: string, planDigest: string, now: Date = new Date()): Promise<void> {
  if (!DIGEST_PATTERN.test(planDigest)) throw new Error(`invalid plan digest: ${JSON.stringify(planDigest)}`);
  const integration: DeftIntegration = { mode: 'managed', plan_digest: planDigest, enabled_at: now.toISOString() };
  await updateProjectsConfigAsync((config) => {
    const project = config.projects[projectKey] as ProjectWithDeftIntegration | undefined;
    if (!project) throw new Error(`unknown project: ${projectKey}`);
    project.deft_integration = integration;
    return { config, result: undefined, changed: true };
  });
}

/** Remove the stored decision; true when there was one. Touches nothing else. */
export async function disableDeftManaged(projectKey: string): Promise<boolean> {
  return updateProjectsConfigAsync((config) => {
    const project = config.projects[projectKey] as ProjectWithDeftIntegration | undefined;
    if (!project || !Object.hasOwn(project, 'deft_integration')) return { config, result: false, changed: false };
    delete project.deft_integration;
    return { config, result: true, changed: true };
  });
}
