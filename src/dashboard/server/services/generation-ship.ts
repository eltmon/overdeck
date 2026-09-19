/**
 * Ship a promoted UAT batch at a deferred version (PAN-3917, D6).
 *
 * This used to live in `cloister/ship-record.ts`, which ran the version ship
 * and then wrote a `PanIssueShipRecord` to every member issue's record. There
 * are no records: a batch's ship state is its git tag and its GitHub release,
 * and the report below is what the operator sees. Nothing is persisted.
 */

import { relative, resolve } from 'node:path';

import { getUatGenerationSync, type UatGeneration } from '../../../lib/overdeck/merge-sync.js';
import { resolveConfiguredReposSync } from '../../../lib/project-repos.js';
import { findProjectByPathSync, listProjectsSync, type ProjectConfig } from '../../../lib/projects.js';
import { runVersionShip, VersionShipOperationError, type ShipReport } from '../../../lib/cloister/version-ship.js';
import { buildVersionShipDeps } from '../../../lib/cloister/version-ship-deps.js';
import { withVersionShipWorkspace, type VersionShipSourceRepo } from '../../../lib/cloister/version-ship-worktree.js';

export type ShipPromotedBatchFailure = 'not-found' | 'wrong-status' | 'not-configured';

export class ShipPromotedBatchError extends Error {
  constructor(readonly reason: ShipPromotedBatchFailure, message: string) {
    super(message);
    this.name = 'ShipPromotedBatchError';
  }
}

/** One in-flight ship per generation, so two clicks cannot race the same tag. */
const generationShipTails = new Map<string, Promise<void>>();

export async function withGenerationShipLock<T>(generationName: string, run: () => Promise<T>): Promise<T> {
  const previous = generationShipTails.get(generationName) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve_) => { release = resolve_; });
  generationShipTails.set(generationName, previous.then(() => tail));
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (generationShipTails.get(generationName) === tail) generationShipTails.delete(generationName);
  }
}

function registeredSourceRepos(generation: UatGeneration, project: ProjectConfig): VersionShipSourceRepo[] {
  const entry = listProjectsSync().find((candidate) => resolve(candidate.config.path) === resolve(project.path));
  if (!entry) {
    throw new VersionShipOperationError('workspace-failed', 'project is not present in the registered project catalog');
  }
  const configured = resolveConfiguredReposSync(entry.key, project.path, project, `${entry.key}-ship`)
    .filter((repo) => repo.required);

  return (generation.repos ?? []).map((repo) => {
    const registered = configured.find((candidate) => resolve(candidate.repoPath) === resolve(repo.repoPath));
    if (!registered) {
      throw new VersionShipOperationError('workspace-failed', `generation repository is not registered for ship: ${repo.repoKey}`);
    }
    if (!repo.mergeSha) {
      throw new VersionShipOperationError('workspace-failed', `generation repository has no promoted merge reference: ${repo.repoKey}`);
    }
    const configPath = relative(resolve(project.path), resolve(registered.repoPath)) || '.';
    return {
      repoKey: registered.repoKey,
      repoPath: registered.repoPath,
      configPath,
      mergeSha: repo.mergeSha,
      targetBranch: repo.targetBranch || registered.targetBranch,
    };
  });
}

export interface ExecuteVersionShipDeps {
  prepare: typeof withVersionShipWorkspace;
  runShip: typeof runVersionShip;
}

const defaultExecuteDeps: ExecuteVersionShipDeps = {
  prepare: withVersionShipWorkspace,
  runShip: runVersionShip,
};

export async function executeVersionShipForGeneration(
  args: { generation: UatGeneration; project: ProjectConfig; version: string },
  deps: ExecuteVersionShipDeps = defaultExecuteDeps,
): Promise<ShipReport> {
  try {
    const sourceRepos = registeredSourceRepos(args.generation, args.project);
    return await deps.prepare(sourceRepos, (workspace) => deps.runShip({
      projectRoot: workspace.projectRoot,
      config: args.project.version_sync!,
      version: args.version,
      batchName: args.generation.name,
      allowedRepos: workspace.allowedRepos,
    }, buildVersionShipDeps()));
  } catch (error) {
    const operation = error instanceof VersionShipOperationError ? error : null;
    return {
      status: 'failed',
      version: args.version,
      batch: args.generation.name,
      paths: [],
      errorCode: operation?.code ?? 'workspace-failed',
      error: operation?.safeMessage ?? 'could not prepare the promoted batch for version ship',
      at: new Date().toISOString(),
    };
  }
}

export interface ShipPromotedBatchDeps {
  getGeneration: typeof getUatGenerationSync;
  findProject: typeof findProjectByPathSync;
  execute?: typeof executeVersionShipForGeneration;
}

const defaultPromotedBatchDeps: ShipPromotedBatchDeps = {
  getGeneration: getUatGenerationSync,
  findProject: findProjectByPathSync,
};

export async function shipPromotedBatch(
  args: { generationName: string; projectRoot: string; version: string },
  deps: ShipPromotedBatchDeps = defaultPromotedBatchDeps,
): Promise<ShipReport> {
  const generation = deps.getGeneration(args.generationName);
  if (!generation || resolve(generation.projectRoot) !== resolve(args.projectRoot)) {
    throw new ShipPromotedBatchError('not-found', `No UAT generation named ${args.generationName}`);
  }
  if (generation.status !== 'promoted') {
    throw new ShipPromotedBatchError(
      'wrong-status',
      `${args.generationName} is ${generation.status} — only a promoted batch can ship a deferred version`,
    );
  }

  const project = deps.findProject(args.projectRoot);
  if (!project?.version_sync) {
    throw new ShipPromotedBatchError(
      'not-configured',
      `${args.generationName} belongs to a project with no version_sync configuration`,
    );
  }

  return withGenerationShipLock(generation.name, () =>
    (deps.execute ?? executeVersionShipForGeneration)({ generation, project, version: args.version }));
}
