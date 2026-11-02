/**
 * Switch one issue onto Deft Directive's pipeline and back (PAN-4820 WI-13).
 *
 * `useDeftPipeline` stops the issue's agents, records `pipeline: deft`,
 * makes sure the workspace exists, installs Directive into it (hidden from
 * git; a native Directive project needs no install), and writes a one-item
 * stand-in plan when the issue has none, so `pan start` and the dashboard's
 * plan checks pass without edits (AD-3). Any failure after the pipeline is
 * recorded undoes the install and resets the pipeline.
 *
 * `backToOverdeck` stops the agents, saves the Deft state archive, removes
 * the install exactly, resets the pipeline, and deletes the stand-in plan, so
 * `pan start` then routes the issue to Overdeck planning.
 *
 * Out of v1 (AD-16): polyrepo and remote (Fly) workspaces are refused.
 */
import { execFile } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { stopAgent } from '../agents/termination.js';
import { stopIssueSpecialistAgents } from '../agents/issue-pause.js';
import { getIssueWorkspacePath } from '../overdeck/issue-projects.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import { loadWorkspaceMetadata } from '../remote/workspace-metadata.js';
import { setIssuePipeline } from '../skill-overrides/store.js';
import { writeAutoStartXBrief } from '../xbrief/auto-synthesize.js';
import { findPlan } from '../xbrief/io.js';
import { isNativeDirectiveProject, saveDeftState } from './archive.js';
import { type DeftInstallResult, installDeftIntoWorktree } from './install.js';
import { readDeftSnapshot } from './install-snapshot.js';
import { type DeftRemoveResult, removeDeftInstall } from './uninstall.js';

const execFileAsync = promisify(execFile);
const WORKSPACE_CREATE_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFT_PLACEHOLDER_TITLE = 'Deliver through Deft Directive';

export class DeftSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeftSwitchError';
  }
}

export interface DeftSwitchDeps {
  resolveProject?: (issueId: string) => { projectKey: string; projectPath: string; polyrepo: boolean } | null;
  isRemote?: (issueId: string) => boolean;
  workspacePath?: (issueId: string) => string | null;
  stopAgents?: (issueId: string) => Promise<void>;
  setPipeline?: (issueId: string, pipeline: 'deft' | 'overdeck') => Promise<unknown>;
  workspaceExists?: (workspace: string) => Promise<boolean>;
  createWorkspace?: (issueId: string) => Promise<void>;
  install?: (workspace: string, issueId: string) => Promise<DeftInstallResult>;
  remove?: (workspace: string) => Promise<DeftRemoveResult>;
  save?: (workspace: string, issueId: string) => Promise<{ committed: boolean; sha?: string; files: number }>;
  nativeDirective?: (workspace: string) => Promise<boolean>;
  hasSnapshot?: (workspace: string) => Promise<boolean>;
  findPlanPath?: (workspace: string) => Promise<string | null>;
  writePlaceholderPlan?: (projectPath: string, workspace: string, issueId: string) => Promise<void>;
}

export interface UseDeftResult {
  mode: 'temporary-install' | 'directive-project';
  /** Created and modified paths the install hid from git. */
  snapshotPaths: string[];
  workspace: string;
  placeholderPlan: boolean;
}

export interface BackToOverdeckResult {
  removed: string[];
  restored: string[];
  archiveSha: string | null;
  next: string;
  /** No readable install snapshot: the exact undo was impossible, and the install's files are visible to git again. */
  snapshotMissing?: boolean;
  /** Tracked files unhidden by the recovery path, still holding the install's content. */
  unhidden?: string[];
}

function defaultResolveProject(issueId: string): { projectKey: string; projectPath: string; polyrepo: boolean } | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  const config = getProjectSync(resolved.projectKey);
  return { projectKey: resolved.projectKey, projectPath: resolved.projectPath, polyrepo: config?.workspace?.type === 'polyrepo' };
}

async function defaultStopAgents(issueId: string): Promise<void> {
  await Effect.runPromise(stopAgent(`agent-${issueId.toLowerCase()}`, 'operator').pipe(Effect.catch(() => Effect.void)));
  await stopIssueSpecialistAgents(issueId);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultCreateWorkspace(issueId: string): Promise<void> {
  await execFileAsync('pan', ['workspace', 'create', issueId, '--local'], { timeout: WORKSPACE_CREATE_TIMEOUT_MS });
}

async function readPlanMetadata(path: string): Promise<Record<string, unknown> | null> {
  try {
    const doc = JSON.parse(await readFile(path, 'utf8')) as { plan?: { metadata?: Record<string, unknown> } };
    return doc.plan?.metadata ?? null;
  } catch {
    return null;
  }
}

/** Write the one-item stand-in plan and mark it `plan.metadata.deftPlaceholder` (AD-3). */
async function defaultWritePlaceholderPlan(projectPath: string, workspace: string, issueId: string): Promise<void> {
  const written = await Effect.runPromise(writeAutoStartXBrief(projectPath, workspace, { issueId, title: DEFT_PLACEHOLDER_TITLE }));
  const doc = JSON.parse(await readFile(written.projectSpecPath, 'utf8')) as { plan: { metadata?: Record<string, unknown> } };
  doc.plan.metadata = { ...(doc.plan.metadata ?? {}), deftPlaceholder: true };
  await writeFile(written.projectSpecPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

function withDefaults(deps: DeftSwitchDeps): Required<DeftSwitchDeps> {
  return {
    resolveProject: deps.resolveProject ?? defaultResolveProject,
    isRemote: deps.isRemote ?? (issueId => loadWorkspaceMetadata(issueId)?.location === 'remote'),
    workspacePath: deps.workspacePath ?? getIssueWorkspacePath,
    stopAgents: deps.stopAgents ?? defaultStopAgents,
    setPipeline: deps.setPipeline ?? setIssuePipeline,
    workspaceExists: deps.workspaceExists ?? exists,
    createWorkspace: deps.createWorkspace ?? defaultCreateWorkspace,
    install: deps.install ?? ((workspace, issueId) => installDeftIntoWorktree(workspace, issueId)),
    remove: deps.remove ?? removeDeftInstall,
    save: deps.save ?? saveDeftState,
    nativeDirective: deps.nativeDirective ?? isNativeDirectiveProject,
    hasSnapshot: deps.hasSnapshot ?? (async workspace => (await readDeftSnapshot(workspace)) !== null),
    findPlanPath: deps.findPlanPath ?? (workspace => Effect.runPromise(findPlan(workspace))),
    writePlaceholderPlan: deps.writePlaceholderPlan ?? defaultWritePlaceholderPlan,
  };
}

/** AD-16: polyrepo and remote workspaces are out of v1. */
function refuseUnsupported(issueId: string, d: Required<DeftSwitchDeps>): { projectPath: string; workspace: string } {
  const project = d.resolveProject(issueId);
  if (!project) throw new DeftSwitchError(`no registered project owns ${issueId}`);
  if (project.polyrepo) throw new DeftSwitchError(`${issueId} is in a polyrepo workspace; running an issue on Deft supports single-repo workspaces only`);
  if (d.isRemote(issueId)) throw new DeftSwitchError(`${issueId} has a remote workspace; running an issue on Deft supports local workspaces only`);
  const workspace = d.workspacePath(issueId);
  if (!workspace) throw new DeftSwitchError(`no workspace path for ${issueId}`);
  return { projectPath: project.projectPath, workspace };
}

export async function useDeftPipeline(issueId: string, deps: DeftSwitchDeps = {}): Promise<UseDeftResult> {
  const issue = issueId.toUpperCase();
  const d = withDefaults(deps);
  const { projectPath, workspace } = refuseUnsupported(issue, d);

  await d.stopAgents(issue);
  await d.setPipeline(issue, 'deft');
  try {
    if (!(await d.workspaceExists(workspace))) await d.createWorkspace(issue);
    const result = await d.install(workspace, issue);
    if (!result.ok) throw new DeftSwitchError(result.error);
    let placeholderPlan = false;
    if ((await d.findPlanPath(workspace)) === null) {
      await d.writePlaceholderPlan(projectPath, workspace, issue);
      placeholderPlan = true;
    }
    if (result.mode === 'directive-project') return { mode: 'directive-project', snapshotPaths: [], workspace, placeholderPlan };
    const { snapshot } = result;
    return {
      mode: 'temporary-install',
      snapshotPaths: [...snapshot.createdPaths, ...snapshot.modifiedTracked.map(entry => entry.path)],
      workspace,
      placeholderPlan,
    };
  } catch (error) {
    // Undo whatever the install left (installDeftIntoWorktree returns a snapshot for a failed install that changed files).
    if (await d.hasSnapshot(workspace).catch(() => false)) await d.remove(workspace);
    await d.setPipeline(issue, 'overdeck');
    throw error;
  }
}

export async function backToOverdeck(issueId: string, deps: DeftSwitchDeps = {}): Promise<BackToOverdeckResult> {
  const issue = issueId.toUpperCase();
  const d = withDefaults(deps);
  const workspace = d.workspacePath(issue);
  if (!workspace) throw new DeftSwitchError(`no workspace path for ${issue}`);

  await d.stopAgents(issue);
  let archiveSha: string | null = null;
  if (!(await d.nativeDirective(workspace))) {
    const saved = await d.save(workspace, issue);
    archiveSha = saved.sha ?? null;
  }
  const { removed, restored, snapshotMissing, unhidden } = await d.remove(workspace);
  await d.setPipeline(issue, 'overdeck');

  const planPath = await d.findPlanPath(workspace);
  if (planPath && (await readPlanMetadata(planPath))?.deftPlaceholder === true) await rm(planPath, { force: true });
  return {
    removed,
    restored,
    archiveSha,
    next: `pan start ${issue}`,
    ...(snapshotMissing ? { snapshotMissing: true, unhidden: unhidden ?? [] } : {}),
  };
}
