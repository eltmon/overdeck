import type { FlywheelStats } from '@overdeck/contracts';
import {
  computeFlywheelStats,
  parseFlywheelStatsWindow,
} from '../../dashboard/server/services/flywheel-telemetry.js';
import { derivePipelineRunStatsInputs } from '../../dashboard/server/services/pipeline-run-metrics.js';
import { parseAffectedCriteria } from './affected-criteria.js';
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

interface SubstrateBugInput extends FlywheelSubstrateBug {
  body?: string | null;
  labels?: readonly string[];
}

export interface ListSubstrateBugWeightsDeps {
  stats?: FlywheelStats;
  completedPipelineRuns?: number;
  computeStats?: typeof computeFlywheelStats;
  deriveInputs?: typeof derivePipelineRunStatsInputs;
  listBugs?: (since: string, until: string) => SubstrateBugInput[] | Promise<SubstrateBugInput[]>;
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

  const listBugs = deps.listBugs ?? (listInWindow as (since: string, until: string) => SubstrateBugInput[] | Promise<SubstrateBugInput[]>);
  const bugs = await listBugs(since, until);
  const insufficientTelemetry = completedPipelineRuns < 3;

  const rows = bugs.map((bug) => {
    const affectedCriteria = parseAffectedCriteria(bug.body, bug.labels);

    if (insufficientTelemetry) {
      return {
        issueId: bug.issueId,
        severity: bug.severity,
        filedBy: bug.filedBy,
        affectedCriteria,
        weight: 0,
        weightReason: `Insufficient telemetry: ${completedPipelineRuns} completed pipeline run${completedPipelineRuns === 1 ? '' : 's'} in window (need 3)`,
      };
    }

    const { weight, reason } = computeSubstrateBugWeight(affectedCriteria, stats);
    return {
      issueId: bug.issueId,
      severity: bug.severity,
      filedBy: bug.filedBy,
      affectedCriteria,
      weight,
      weightReason: reason,
    };
  });

  return rows.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.issueId.localeCompare(b.issueId);
  });
}
