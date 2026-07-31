import { resolve } from 'node:path';
import { findProjectByPathSync, type ProjectConfig } from '../projects.js';
import { getUatGenerationSync, type UatGeneration } from '../overdeck/merge-sync.js';
import { updateIssueRecord } from '../pan-dir/record-update.js';
import { resolveProjectForIssue, type PanIssueShipRecord } from '../pan-dir/record.js';
import { buildVersionShipDeps } from './version-ship-deps.js';
import { runVersionShip, type ShipReport } from './version-ship.js';

interface ShipRecordDeps {
  resolveProject: (issueId: string) => ProjectConfig | null;
  updateRecord: typeof updateIssueRecord;
}

const defaultRecordDeps: ShipRecordDeps = {
  resolveProject: resolveProjectForIssue,
  updateRecord: updateIssueRecord,
};

async function persistRecordForMembers(
  generation: UatGeneration,
  ship: PanIssueShipRecord,
  deps: ShipRecordDeps,
): Promise<string[]> {
  const persisted: string[] = [];
  for (const member of generation.members) {
    const project = deps.resolveProject(member.issueId);
    if (!project) throw new Error(`Could not resolve project for ${member.issueId}`);
    await deps.updateRecord(project, member.issueId, record => {
      record.pipeline.ship = ship;
    });
    persisted.push(member.issueId);
  }
  return persisted;
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
  runShip: typeof runVersionShip;
  persist: typeof persistShipRecords;
}

const defaultPromotedBatchDeps: ShipPromotedBatchDeps = {
  getGeneration: getUatGenerationSync,
  findProject: findProjectByPathSync,
  runShip: runVersionShip,
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

  const report = await deps.runShip({
    projectRoot: args.projectRoot,
    config: project.version_sync,
    version: args.version,
    batchName: generation.name,
  }, buildVersionShipDeps());
  await deps.persist(generation, report);
  return report;
}
