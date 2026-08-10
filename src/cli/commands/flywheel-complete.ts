import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FlywheelStatus, OrderBook } from '@overdeck/contracts';

import {
  getFlywheelRunDir,
  readFlywheelLaunchMetadata,
} from '../../dashboard/server/services/flywheel-run-state.js';
import { isFlywheelAutoPickupBacklog } from '../../lib/overdeck/control-settings.js';
import { computeBookProgress, firstReadyBookInQueue, getBook } from '../../lib/orders/resolver.js';
import type { OrderBookProgress } from '../../lib/orders/types.js';
import { advanceQueue } from '../../lib/orders/writer.js';
import { findProjectByPathSync, listProjectsSync, resolveProjectPath } from '../../lib/projects.js';
import { resolveStateReadHomeSync } from '../../lib/state-read-home.js';

export interface CompleteFlywheelOptions {
  cwd?: string;
  force?: boolean;
}

interface StartContinuationOptions {
  cwd: string;
  brief?: string;
  orders?: string;
}

interface StartContinuationResult {
  runId: string;
}

export interface CompleteFlywheelDeps {
  loadStatus: () => Promise<FlywheelStatus | null>;
  buildReport: (status: FlywheelStatus, cwd: string) => Promise<string>;
  persistReport: (status: FlywheelStatus, cwd: string, report: string) => Promise<void>;
  clearGate: (runId: string) => void;
  start: (options: StartContinuationOptions) => Promise<StartContinuationResult>;
  readLaunch?: typeof readFlywheelLaunchMetadata;
  stateRoot?: (workspace: string) => string;
  getOrderBook?: typeof getBook;
  computeProgress?: (book: OrderBook) => OrderBookProgress;
  advance?: typeof advanceQueue;
  autoPickupBacklog?: () => boolean;
  readRetro?: (path: string) => Promise<string | null>;
  listProjects?: typeof listProjectsSync;
  firstReady?: typeof firstReadyBookInQueue;
}

export interface CompleteFlywheelResult {
  runId: string;
  reportPath: string;
  retrospectiveIncluded: boolean;
  continuation: 'next-book' | 'backlog' | 'needs-you';
  nextRunId?: string;
  nextBookId?: string;
  nextProjectKey?: string;
}

function stateRootFor(workspace: string): string {
  const project = findProjectByPathSync(workspace);
  if (!project) throw new Error(`No configured project contains ${workspace}`);
  return resolveStateReadHomeSync(project).root;
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

export function appendFlywheelRetrospective(report: string, retro: string | null): {
  report: string;
  retrospectiveIncluded: boolean;
} {
  const finding = retro?.trim();
  if (!finding) {
    return {
      report: `${report.trimEnd()}\n\nRetrospective: no findings recognized.\n`,
      retrospectiveIncluded: false,
    };
  }
  return {
    report: `${report.trimEnd()}\n\n---\n\n## Retrospective\n\n${finding}\n`,
    retrospectiveIncluded: true,
  };
}

function nonTerminalIssues(progress: OrderBookProgress): string[] {
  return progress.items.filter((item) => !item.terminal).map((item) => item.issue);
}

/**
 * A ready book is an explicit operator release, so continuation looks past the
 * completing project: every tracked project's ready queue is scanned in registry
 * order and the first hit wins. Run scope governs backlog pickup, not this.
 */
function findCrossProjectContinuation(
  stateRoot: string,
  deps: CompleteFlywheelDeps,
): { projectKey: string; cwd: string; book: OrderBook } | null {
  const firstReady = deps.firstReady ?? firstReadyBookInQueue;
  for (const { key, config } of (deps.listProjects ?? listProjectsSync)()) {
    const projectStateRoot = resolveStateReadHomeSync(config, key).root;
    if (projectStateRoot === stateRoot) continue;
    const book = firstReady(projectStateRoot);
    // resolveProjectPath returns the project's primary root, which the Flywheel
    // start path requires — it uses options.cwd verbatim.
    if (book) return { projectKey: key, cwd: resolveProjectPath(config), book };
  }
  return null;
}

export async function completeFlywheelRun(
  options: CompleteFlywheelOptions,
  deps: CompleteFlywheelDeps,
): Promise<CompleteFlywheelResult> {
  const cwd = options.cwd ?? process.cwd();
  const status = await deps.loadStatus();
  if (!status) throw new Error('no flywheel run to complete');

  const launch = await (deps.readLaunch ?? readFlywheelLaunchMetadata)(status.runId);
  if (!launch) throw new Error(`Flywheel run ${status.runId} is missing launch metadata`);
  const bookId = launch.orders?.bookId;
  if (!bookId) throw new Error(`Flywheel run ${status.runId} is not bound to an order book; use pan flywheel report`);

  const stateRoot = (deps.stateRoot ?? stateRootFor)(launch.workspace);
  const book = (deps.getOrderBook ?? getBook)(stateRoot, bookId);
  if (!book) throw new Error(`Flywheel run ${status.runId} references missing order book ${bookId}`);
  const progress = (deps.computeProgress ?? computeBookProgress)(book);
  const remaining = nonTerminalIssues(progress);
  if (!progress.drained && !options.force) {
    throw new Error(`Order book ${book.id} is not drained; non-terminal items: ${remaining.join(', ')}. Pass --force to complete anyway.`);
  }

  const runDir = getFlywheelRunDir(status.runId);
  const retro = await (deps.readRetro ?? readOptionalFile)(join(runDir, 'retro.md'));
  const report = appendFlywheelRetrospective(await deps.buildReport(status, cwd), retro);
  try {
    await deps.persistReport(status, cwd, report.report);
  } finally {
    deps.clearGate(status.runId);
  }

  const nextBook = await (deps.advance ?? advanceQueue)(stateRoot, book.id);
  const startOptions = { cwd: launch.workspace, brief: launch.briefPath };
  if (nextBook) {
    const next = await deps.start({ ...startOptions, orders: nextBook.id });
    return {
      runId: status.runId,
      reportPath: join(runDir, 'report.md'),
      retrospectiveIncluded: report.retrospectiveIncluded,
      continuation: 'next-book',
      nextRunId: next.runId,
      nextBookId: nextBook.id,
    };
  }
  const crossProject = findCrossProjectContinuation(stateRoot, deps);
  if (crossProject) {
    // No brief: requireFlywheelBrief resolves the target project's own default
    // docs/flywheel-brief.md, so the completing project's brief never leaks over.
    const next = await deps.start({ cwd: crossProject.cwd, orders: crossProject.book.id });
    return {
      runId: status.runId,
      reportPath: join(runDir, 'report.md'),
      retrospectiveIncluded: report.retrospectiveIncluded,
      continuation: 'next-book',
      nextRunId: next.runId,
      nextBookId: crossProject.book.id,
      nextProjectKey: crossProject.projectKey,
    };
  }
  if ((deps.autoPickupBacklog ?? isFlywheelAutoPickupBacklog)()) {
    const next = await deps.start(startOptions);
    return {
      runId: status.runId,
      reportPath: join(runDir, 'report.md'),
      retrospectiveIncluded: report.retrospectiveIncluded,
      continuation: 'backlog',
      nextRunId: next.runId,
    };
  }
  return {
    runId: status.runId,
    reportPath: join(runDir, 'report.md'),
    retrospectiveIncluded: report.retrospectiveIncluded,
    continuation: 'needs-you',
  };
}

export function createFlywheelCompleteCommand(deps: CompleteFlywheelDeps) {
  return async (options: CompleteFlywheelOptions = {}): Promise<void> => {
    try {
      const result = await completeFlywheelRun(options, deps);
      if (result.continuation === 'next-book') {
        const project = result.nextProjectKey ? ` (project: ${result.nextProjectKey})` : '';
        console.log(`Completed ${result.runId}; started ${result.nextRunId} with order book ${result.nextBookId}${project}.`);
      } else if (result.continuation === 'backlog') {
        console.log(`Completed ${result.runId}; started ${result.nextRunId} in backlog mode.`);
      } else {
        console.log('needs-you: pipeline idle — no order book queued and auto-pickup is off');
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  };
}
