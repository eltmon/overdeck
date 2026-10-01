import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EffortLevel } from '@overdeck/contracts';
import type { EvalUsage } from './eval-usage.js';
import type { PromptScenarioRun } from './prompt-harness.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..');

/** Cross-run result store. Gitignored: runs are local and cost money; the posted table is the durable artifact. */
export const DEFAULT_RESULTS_DIR = path.join(repoRoot, 'evals', 'results');

export type EvalSuite = 'review-recall' | 'plan-quality' | 'summary-faithfulness' | 'feedback-acceptance';

export interface EvalCaseRecord {
  suite: EvalSuite;
  caseId: string;
  model: string;
  provider: 'anthropic' | 'openai';
  effort: EffortLevel | null;
  openaiVia: 'api' | 'cliproxy' | null;
  /** Anthropic route; null for OpenAI and for records written before PAN-4406. */
  anthropicVia: 'api' | 'claude-cli' | null;
  /** 0..1 */
  score: number;
  /** Suite-specific sub-scores. */
  metrics: Record<string, number | null>;
  usage: EvalUsage;
  costUsd: number | null;
  costBasis: 'api' | 'api-equivalent';
  durationMs: number;
  /** ISO 8601 */
  recordedAt: string;
}

export function recordFromRun(
  suite: EvalSuite,
  caseId: string,
  run: PromptScenarioRun,
  score: number,
  metrics: Record<string, number | null>,
  now: Date = new Date(),
): EvalCaseRecord {
  return {
    suite,
    caseId,
    model: run.model,
    provider: run.provider,
    effort: run.effort,
    openaiVia: run.openaiVia,
    anthropicVia: run.anthropicVia,
    score,
    metrics,
    usage: run.usage,
    costUsd: run.costUsd,
    costBasis: run.costBasis,
    durationMs: run.durationMs,
    recordedAt: now.toISOString(),
  };
}

export function appendEvalRecord(record: EvalCaseRecord, resultsDir: string = DEFAULT_RESULTS_DIR): void {
  mkdirSync(resultsDir, { recursive: true });
  appendFileSync(path.join(resultsDir, `${record.suite}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
}

export function parseEvalRecords(jsonl: string): EvalCaseRecord[] {
  const records: EvalCaseRecord[] = [];
  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`Malformed eval record on line ${i + 1}: ${(err as Error).message}`);
    }
    const r = parsed as Partial<EvalCaseRecord> | null;
    if (
      !r ||
      typeof r !== 'object' ||
      typeof r.suite !== 'string' ||
      typeof r.caseId !== 'string' ||
      typeof r.model !== 'string' ||
      typeof r.score !== 'number' ||
      typeof r.recordedAt !== 'string' ||
      !r.usage
    ) {
      throw new Error(`Malformed eval record on line ${i + 1}: missing suite, caseId, model, score, usage or recordedAt`);
    }
    records.push(r as EvalCaseRecord);
  }
  return records;
}

function caseKey(r: EvalCaseRecord): string {
  return JSON.stringify([r.suite, r.model, r.effort, r.caseId]);
}

/** Latest recordedAt per (suite, model, effort, caseId). */
export function latestRecords(records: EvalCaseRecord[]): EvalCaseRecord[] {
  const latest = new Map<string, EvalCaseRecord>();
  for (const r of records) {
    const key = caseKey(r);
    const existing = latest.get(key);
    if (!existing || Date.parse(r.recordedAt) > Date.parse(existing.recordedAt)) {
      latest.set(key, r);
    }
  }
  return [...latest.values()];
}

/** Cases of `suite` where exactly one provider family has a record with metrics[metric] === 1. */
export function singleFamilyFinds(
  records: EvalCaseRecord[],
  suite: EvalSuite,
  metric: string,
): { anthropic: string[]; openai: string[] } {
  const families = new Map<string, Set<'anthropic' | 'openai'>>();
  for (const r of latestRecords(records)) {
    if (r.suite !== suite) continue;
    const set = families.get(r.caseId) ?? new Set();
    if (r.metrics[metric] === 1) set.add(r.provider);
    families.set(r.caseId, set);
  }
  const result = { anthropic: [] as string[], openai: [] as string[] };
  for (const [caseId, set] of [...families.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (set.size !== 1) continue;
    const [family] = [...set];
    result[family!].push(caseId);
  }
  return result;
}

export function renderPlacementTable(records: EvalCaseRecord[]): string {
  const groups = new Map<string, EvalCaseRecord[]>();
  for (const r of records) {
    const key = JSON.stringify([r.suite, r.model, r.effort]);
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }

  const rows = [...groups.values()]
    .map((group) => {
      const first = group[0]!;
      const meanScore = group.reduce((sum, r) => sum + r.score, 0) / group.length;
      const inputTokens = group.reduce(
        (sum, r) => sum + r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens,
        0,
      );
      const outputTokens = group.reduce((sum, r) => sum + r.usage.outputTokens, 0);
      const cost = group.some((r) => r.costUsd === null)
        ? 'n/a'
        : group.reduce((sum, r) => sum + (r.costUsd ?? 0), 0).toFixed(4);
      const costBasis = [...new Set(group.map((r) => r.costBasis))].sort().join(', ');
      return {
        suite: first.suite,
        model: first.model,
        effort: first.effort ?? 'n/a',
        cells: [
          first.suite,
          first.model,
          first.effort ?? 'n/a',
          String(group.length),
          meanScore.toFixed(3),
          String(inputTokens),
          String(outputTokens),
          cost,
          costBasis,
        ],
      };
    })
    .sort((a, b) => a.suite.localeCompare(b.suite) || a.model.localeCompare(b.model) || a.effort.localeCompare(b.effort));

  const lines = [
    '| Suite | Model | Effort | Cases | Mean score | Input tok | Output tok | Cost (USD) | Cost basis |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${row.cells.join(' | ')} |`),
  ];

  const finds = singleFamilyFinds(records, 'review-recall', 'recall');
  lines.push(
    '',
    '### Review recall: blockers found by one family only',
    '',
    `- anthropic: ${finds.anthropic.length} (${finds.anthropic.join(', ')})`,
    `- openai: ${finds.openai.length} (${finds.openai.join(', ')})`,
  );
  lines.push('', '### Review recall: found vs rated blocking', '', ...reviewSeverityLines(records));
  return `${lines.join('\n')}\n`;
}

/**
 * One line per (model, effort): any-severity recall, blocking recall, and how often a found
 * blocker was rated blocking. Records written before the split (no blockingRecall) are skipped:
 * their `recall` meant blocking recall.
 */
function reviewSeverityLines(records: EvalCaseRecord[]): string[] {
  const groups = new Map<string, EvalCaseRecord[]>();
  for (const r of records) {
    if (r.suite !== 'review-recall' || !('blockingRecall' in r.metrics)) continue;
    const key = JSON.stringify([r.model, r.effort ?? 'n/a']);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [model, effort] = JSON.parse(key) as [string, string];
      const count = (metric: string) => group.filter((r) => r.metrics[metric] === 1).length;
      const found = count('recall');
      const blocking = count('blockingRecall');
      const sufficient = group.filter((r) => r.metrics.excerptSufficient === 1);
      const sufficientFound = sufficient.filter((r) => r.metrics.recall === 1).length;
      return {
        model,
        effort,
        line:
          `- ${model} (${effort}): recall ${found}/${group.length}; blocking recall ${blocking}/${group.length}; ` +
          `rated blocking when found ${blocking}/${found}; excerpt-sufficient recall ${sufficientFound}/${sufficient.length}`,
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.effort.localeCompare(b.effort))
    .map((g) => g.line);
}
