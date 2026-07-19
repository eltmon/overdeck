import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  getFlywheelRunDir,
  readFlywheelLaunchMetadata,
  resolveLiveFlywheelRunId,
} from '../../dashboard/server/services/flywheel-run-state.js';
import { getReviewStatusSync } from '../review-status.js';
import { findProjectByPathSync } from '../projects.js';
import { resolveStateReadHomeSync } from '../state-read-home.js';
import { getWorkAgentLifecycleStateSync } from '../work-agent-lifecycle.js';
import { evaluateOrderDispatchEligibility, type OrderDispatchEligibility } from './eligibility.js';
import { computeBookProgress, getBook, liveOrderIssueLookup } from './resolver.js';
import type { OrderIssueLookup } from './types.js';

interface OrdersLaunchMetadata {
  orders?: { bookId?: string };
}

export interface ActiveOrderDispatchCheck {
  ordersBound: boolean;
  runId?: string;
  bookId?: string;
  decision: OrderDispatchEligibility;
}

export interface ActiveOrderDispatchDeps {
  resolveRunId?: typeof resolveLiveFlywheelRunId;
  readLaunch?: typeof readFlywheelLaunchMetadata;
  stateRoot?: (projectRoot: string) => string;
  getOrderBook?: typeof getBook;
  computeProgress?: typeof computeBookProgress;
  issueLookup?: OrderIssueLookup;
  reservedIssues?: ReadonlySet<string>;
  inFlightIssues?: (bookId: string, issueIds: readonly string[]) => ReadonlySet<string>;
}

function stateRootFor(projectRoot: string): string {
  const project = findProjectByPathSync(projectRoot);
  if (!project) throw new Error(`No configured project contains ${projectRoot}`);
  return resolveStateReadHomeSync(project).root;
}

function defaultInFlightIssues(_bookId: string, issueIds: readonly string[]): ReadonlySet<string> {
  const inFlight = new Set<string>();
  for (const issueId of issueIds) {
    const lifecycle = getWorkAgentLifecycleStateSync(issueId);
    const review = getReviewStatusSync(issueId);
    if (lifecycle.isRunning || (review !== null && review.reviewStatus !== 'pending')) {
      inFlight.add(issueId.toUpperCase());
    }
  }
  return inFlight;
}

const booklessDecision: OrderDispatchEligibility = {
  eligible: true,
  overrideUsed: false,
  conditions: [],
};

export async function checkActiveOrderDispatch(
  projectRoot: string,
  issueId: string,
  options: { offBook?: boolean } = {},
  deps: ActiveOrderDispatchDeps = {},
): Promise<ActiveOrderDispatchCheck> {
  const runId = await (deps.resolveRunId ?? resolveLiveFlywheelRunId)();
  if (!runId) return { ordersBound: false, decision: booklessDecision };
  const launch = await (deps.readLaunch ?? readFlywheelLaunchMetadata)(runId) as
    | (Awaited<ReturnType<typeof readFlywheelLaunchMetadata>> & OrdersLaunchMetadata)
    | null;
  const bookId = launch?.orders?.bookId;
  if (!bookId) return { ordersBound: false, runId, decision: booklessDecision };

  const stateRoot = (deps.stateRoot ?? stateRootFor)(projectRoot);
  const book = (deps.getOrderBook ?? getBook)(stateRoot, bookId);
  if (!book) throw new Error(`Active Flywheel run ${runId} references missing order book ${bookId}`);
  const progress = (deps.computeProgress ?? computeBookProgress)(book);
  const prerequisiteIds = [...new Set(book.items.flatMap((item) => item.prereqs.map((prereq) => prereq.toUpperCase())))];
  const prerequisiteState = (deps.issueLookup ?? liveOrderIssueLookup)(prerequisiteIds);
  const prerequisiteTerminal = new Map(prerequisiteIds.map((prereq) => {
    const state = prerequisiteState.get(prereq);
    return [prereq, state ? !state.open || state.parked : false] as const;
  }));
  const inFlightIssues = new Set((deps.inFlightIssues ?? defaultInFlightIssues)(
    book.id,
    book.items.filter((item) => !progress.items.find((entry) => entry.issue === item.issue)?.terminal)
      .map((item) => item.issue),
  ));
  for (const reserved of deps.reservedIssues ?? []) inFlightIssues.add(reserved.toUpperCase());
  return {
    ordersBound: true,
    runId,
    bookId,
    decision: evaluateOrderDispatchEligibility({
      book,
      progress,
      issueId,
      inFlightIssues,
      prerequisiteTerminal,
      offBook: options.offBook,
    }),
  };
}

export async function enforceActiveOrderDispatch(
  projectRoot: string,
  issueId: string,
  options: { offBook?: boolean; recordOverride?: boolean } = {},
  deps: ActiveOrderDispatchDeps = {},
): Promise<ActiveOrderDispatchCheck> {
  const result = await checkActiveOrderDispatch(projectRoot, issueId, options, deps);
  if (!result.decision.eligible) {
    throw new Error(result.decision.message ?? `Order-book dispatch blocked for ${issueId}`);
  }
  if (options.recordOverride && result.decision.overrideUsed && result.runId && result.bookId) {
    await recordOffBookOverride(result.runId, result.bookId, issueId);
  }
  return result;
}

export async function recordOffBookOverride(
  runId: string,
  bookId: string,
  issueId: string,
  actor = process.env['OVERDECK_AGENT_ID'] ?? 'operator',
): Promise<string> {
  const runDir = getFlywheelRunDir(runId);
  const path = join(runDir, 'orders-overrides.jsonl');
  await mkdir(runDir, { recursive: true });
  await appendFile(path, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    runId,
    bookId,
    issueId: issueId.toUpperCase(),
    actor,
    override: 'off-book',
  })}\n`, 'utf8');
  return path;
}
