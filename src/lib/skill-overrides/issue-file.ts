/**
 * Reads of the per-issue skill-override file (PAN-3942, PAN-4820):
 * `<planHome>/.pan/skill-overrides/<ISSUE>.yaml`, holding the issue's
 * `skills:` and `packs:` maps and the `pipeline: deft` key.
 *
 * Split out of `store.ts` so `deft/issue-pipeline.ts` can read the pipeline
 * key without the store's write-side imports (`settings-api`), which would
 * close an import cycle through `agents/spawn.ts`. The YAML is still parsed
 * only here. Every read is async.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { listProjectsAsync, resolveInfraRepo, resolveProjectFromIssueSync, type ProjectConfig } from '../projects.js';

export type ProjectWithSkillOverrides = ProjectConfig & {
  skill_overrides?: Record<string, boolean>;
  skill_pack_overrides?: Record<string, boolean>;
};

export interface IssueOverrides {
  skills: Record<string, boolean>;
  packs: Record<string, boolean>;
  /** PAN-4820: absent = Overdeck's pipeline. */
  pipeline?: 'deft';
}

export function booleanEntries(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [name, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (typeof enabled === 'boolean') out[name] = enabled;
  }
  return out;
}

export async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export function parseYamlOrNull(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
}

export async function findProject(projectKey: string): Promise<ProjectWithSkillOverrides | null> {
  const match = (await listProjectsAsync()).find(project => project.key === projectKey);
  return (match?.config as ProjectWithSkillOverrides | undefined) ?? null;
}

/** `<planHome>/.pan/skill-overrides/<ISSUE>.yaml` */
export function issueSkillOverridesPath(planHome: string, issueId: string): string {
  return join(planHome, PAN_DIRNAME, 'skill-overrides', `${issueId.toUpperCase()}.yaml`);
}

/**
 * The checkout holding a registered project's `.pan/` — what `resolvePlanHome`
 * returns for the project root, computed from the config without re-reading
 * projects.yaml.
 */
export function planHomeFor(project: ProjectConfig): string {
  try {
    return resolveInfraRepo(project, resolve(project.path)).repoPath;
  } catch {
    return resolve(project.path);
  }
}

/** The registered project that owns an issue, with its key. */
export async function projectForIssue(issueId: string): Promise<{ projectKey: string; project: ProjectConfig } | null> {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  const project = await findProject(resolved.projectKey);
  return project ? { projectKey: resolved.projectKey, project } : null;
}

export async function readIssueFile(path: string): Promise<IssueOverrides> {
  const parsed = parseYamlOrNull(await readTextOrEmpty(path)) as { skills?: unknown; packs?: unknown; pipeline?: unknown } | null;
  return {
    skills: booleanEntries(parsed?.skills),
    packs: booleanEntries(parsed?.packs),
    ...(parsed?.pipeline === 'deft' ? { pipeline: 'deft' as const } : {}),
  };
}

export async function readIssueOverrides(issueId: string): Promise<IssueOverrides> {
  const owner = await projectForIssue(issueId);
  if (!owner) return { skills: {}, packs: {} };
  return readIssueFile(issueSkillOverridesPath(planHomeFor(owner.project), issueId));
}

/** The issue file's `pipeline:` key (PAN-4820); undefined = Overdeck's pipeline. */
export async function readIssuePipelineField(issueId: string): Promise<'deft' | undefined> {
  return (await readIssueOverrides(issueId)).pipeline;
}
