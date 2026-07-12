import type { FlywheelStats } from '@overdeck/contracts';
import {
  computeFlywheelStats,
  parseFlywheelStatsWindow,
} from '../../dashboard/server/services/flywheel-telemetry.js';
import { derivePipelineRunStatsInputs } from '../../dashboard/server/services/pipeline-run-metrics.js';
import { computeSubstrateBugWeight } from './substrate-bug-weight.js';
import { listInWindow, type FlywheelSubstrateBug } from './flywheel-substrate-bugs.js';

export interface WeightedSubstrateBug {
  issueId: string;
  severity: string;
  filedBy: FlywheelSubstrateBug['filedBy'];
  affectedCriteria: number[];
  weight: number;
  weightReason: string;
}

export interface ListSubstrateBugWeightsDeps {
  stats?: FlywheelStats;
  completedPipelineRuns?: number;
  computeStats?: typeof computeFlywheelStats;
  deriveInputs?: typeof derivePipelineRunStatsInputs;
  listBugs?: (since: string, until: string) => FlywheelSubstrateBug[] | Promise<FlywheelSubstrateBug[]>;
  limit?: number;
  offset?: number;
  now?: () => Date;
}

export async function listSubstrateBugWeights(
  window = '30d',
  deps: ListSubstrateBugWeightsDeps = {},
): Promise<WeightedSubstrateBug[]> {
  const now = (deps.now ?? (() => new Date()))();
  const parsedWindow = parseFlywheelStatsWindow(window);
  const since = new Date(now.getTime() - parsedWindow.ms).toISOString();
  const until = now.toISOString();

  let stats: FlywheelStats;
  let completedPipelineRuns: number;

  if (deps.stats) {
    stats = deps.stats;
    completedPipelineRuns = deps.completedPipelineRuns ?? 0;
  } else {
    const inputs = await (deps.deriveInputs ?? derivePipelineRunStatsInputs)(since, until);
    completedPipelineRuns = inputs.completedPipelineRuns ?? 0;
    stats = await (deps.computeStats ?? computeFlywheelStats)(window, {
      generatedAt: now,
      ...inputs,
    });
  }

  const listBugs = deps.listBugs ?? listInWindow;
  const bugs = await listBugs(since, until);
  const insufficientTelemetry = completedPipelineRuns < 3;

  const scored = bugs.map((bug) => {
    const affectedCriteria = bug.affectedCriteria;

    if (insufficientTelemetry) {
      return {
        bug,
        weight: 0,
        weightReason: `Insufficient telemetry: ${completedPipelineRuns} completed pipeline run${completedPipelineRuns === 1 ? '' : 's'} in window (need 3)`,
      };
    }

    const { weight, reason } = computeSubstrateBugWeight(affectedCriteria, stats);
    return { bug, weight, weightReason: reason };
  });

  const sorted = scored.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.bug.filedAt.localeCompare(b.bug.filedAt);
  });

  const rows = sorted.map((item) => ({
    issueId: item.bug.issueId,
    severity: item.bug.severity,
    filedBy: item.bug.filedBy,
    affectedCriteria: item.bug.affectedCriteria,
    weight: item.weight,
    weightReason: item.weightReason,
  }));

  const offset = Math.max(0, deps.offset ?? 0);
  if (deps.limit !== undefined) {
    return rows.slice(offset, offset + deps.limit);
  }
  return offset > 0 ? rows.slice(offset) : rows;
}
