import { relative, resolve } from 'node:path';
import {
  findProjectByPathSync,
  listProjectsSync,
  type ProjectConfig,
} from '../projects.js';
import { resolveConfiguredReposSync } from '../project-repos.js';
import { getUatGenerationSync, type UatGeneration } from '../overdeck/merge-sync.js';
import { updateIssueRecord } from '../pan-dir/record-update.js';
import { resolveProjectForIssue, type PanIssueShipRecord } from '../pan-dir/record.js';
import { buildVersionShipDeps } from './version-ship-deps.js';
import {
  runVersionShip,
  VersionShipOperationError,
  type ShipReport,
} from './version-ship.js';
import {
  withVersionShipWorkspace,
  type VersionShipSourceRepo,
} from './version-ship-worktree.js';

interface ShipRecordDeps {
  resolveProject: (issueId: string) => ProjectConfig | null;
  updateRecord: typeof updateIssueRecord;
}

const defaultRecordDeps: ShipRecordDeps = {
  resolveProject: resolveProjectForIssue,
  updateRecord: updateIssueRecord,
};

const RECORD_WRITE_ATTEMPTS = 3;

export class ShipRecordPersistenceError extends Error {
  constructor(
    readonly failedIssueIds: string[],
    readonly persistedIssueIds: string[],
  ) {
    super(`could not persist ship settlement for: ${failedIssueIds.join(', ')}`);
    this.name = 'ShipRecordPersistenceError';
  }
}

async function persistRecordForMembers(
  generation: UatGeneration,
  ship: PanIssueShipRecord,
  deps: ShipRecordDeps,
): Promise<string[]> {
  const persisted = new Set<string>();
  let pending = generation.members.map(member => member.issueId);

  for (let attempt = 1; attempt <= RECORD_WRITE_ATTEMPTS && pending.length > 0; attempt += 1) {
    const retry: string[] = [];
    // State writes share one git-backed write door, so keep them serialized while
    // continuing past one failure; the next round retries every failed member.
    for (const issueId of pending) {
      try {
        const project = deps.resolveProject(issueId);
        if (!project) throw new Error('project resolution failed');
        await deps.updateRecord(project, issueId, record => {
          record.pipeline.ship = ship;
        });
        persisted.add(issueId);
      } catch {
        retry.push(issueId);
      }
    }
    pending = retry;
  }

  if (pending.length > 0) {
    throw new ShipRecordPersistenceError(pending, [...persisted]);
  }
  return [...persisted];
}

export async function persistShipRecords(
  generation: UatGeneration,
  report: ShipReport,
  deps: ShipRecordDeps = defaultRecordDeps,
): Promise<string[]> {
  return persistRecordForMembers(generation, {
    status: report.status,
    version: report.version,
    batch: report.batch,
    paths: report.paths,
    errorCode: report.errorCode,
    error: report.error,
    at: report.at,
  }, deps);
}

export async function persistPendingShipRecords(
  generation: UatGeneration,
  reason: string,
  deps: ShipRecordDeps = defaultRecordDeps,
): Promise<string[]> {
  return persistRecordForMembers(generation, {
    status: 'pending',
    batch: generation.name,
    reason,
    at: new Date().toISOString(),
  }, deps);
}

function registeredSourceRepos(
  generation: UatGeneration,
  project: ProjectConfig,
): VersionShipSourceRepo[] {
  const entry = listProjectsSync().find(candidate => resolve(candidate.config.path) === resolve(project.path));
  if (!entry) {
    throw new VersionShipOperationError('workspace-failed', 'project is not present in the registered project catalog');
  }
  const configured = resolveConfiguredReposSync(entry.key, project.path, project, `${entry.key}-ship`)
    .filter(repo => repo.required);

  return (generation.repos ?? []).map(repo => {
    const registered = configured.find(candidate => resolve(candidate.repoPath) === resolve(repo.repoPath));
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

interface ExecuteVersionShipDeps {
  prepare: typeof withVersionShipWorkspace;
  runShip: typeof runVersionShip;
}

const defaultExecuteDeps: ExecuteVersionShipDeps = {
  prepare: withVersionShipWorkspace,
  runShip: runVersionShip,
};

export async function executeVersionShipForGeneration(
  args: {
    generation: UatGeneration;
    project: ProjectConfig;
    version: string;
  },
  deps: ExecuteVersionShipDeps = defaultExecuteDeps,
): Promise<ShipReport> {
  try {
    const sourceRepos = registeredSourceRepos(args.generation, args.project);
    return await deps.prepare(sourceRepos, workspace => deps.runShip({
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

export type ShipPromotedBatchFailure = 'not-found' | 'wrong-status' | 'not-configured';

export class ShipPromotedBatchError extends Error {
  constructor(readonly reason: ShipPromotedBatchFailure, message: string) {
    super(message);
    this.name = 'ShipPromotedBatchError';
  }
}

interface ShipPromotedBatchDeps {
  getGeneration: (name: string) => UatGeneration | null;
  findProject: (path: string) => ProjectConfig | null;
  execute?: typeof executeVersionShipForGeneration;
  persistPending?: typeof persistPendingShipRecords;
  persist: typeof persistShipRecords;
}

const defaultPromotedBatchDeps: ShipPromotedBatchDeps = {
  getGeneration: getUatGenerationSync,
  findProject: findProjectByPathSync,
  execute: executeVersionShipForGeneration,
  persistPending: persistPendingShipRecords,
  persist: persistShipRecords,
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

  await (deps.persistPending ?? persistPendingShipRecords)(generation, 'deferred version ship in progress');
  const report = await (deps.execute ?? executeVersionShipForGeneration)({ generation, project, version: args.version });
  await deps.persist(generation, report);
  return report;
}
