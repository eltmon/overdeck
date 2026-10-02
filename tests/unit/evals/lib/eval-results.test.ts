import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendEvalRecord,
  latestRecords,
  parseEvalRecords,
  recordFromRun,
  renderPlacementTable,
  singleFamilyFinds,
  type EvalCaseRecord,
} from '../../../../evals/lib/eval-results.js';
import type { PromptScenarioRun } from '../../../../evals/lib/prompt-harness.js';

function run(overrides: Partial<PromptScenarioRun> = {}): PromptScenarioRun {
  return {
    model: 'claude-sonnet-5-5',
    provider: 'anthropic',
    effort: 'high',
    thinking: 'adaptive',
    temperature: null,
    maxTokens: 32000,
    openaiVia: null,
    anthropicVia: 'api',
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, reasoningTokens: null },
    costUsd: 0.01,
    costBasis: 'api',
    stopReason: 'end_turn',
    durationMs: 1200,
    ...overrides,
  };
}

function record(overrides: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    ...recordFromRun('review-recall', 'c1', run(), 1, { recall: 1 }, new Date('2026-09-29T10:00:00.000Z')),
    ...overrides,
  };
}

describe('evals/lib/eval-results', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('recordFromRun copies run info and stamps recordedAt', () => {
    const r = recordFromRun('plan-quality', 'pan-1', run(), 0.5, { lintPass: 1 }, new Date('2026-09-29T10:00:00.000Z'));
    expect(r).toMatchObject({
      suite: 'plan-quality',
      caseId: 'pan-1',
      model: 'claude-sonnet-5-5',
      provider: 'anthropic',
      effort: 'high',
      anthropicVia: 'api',
      score: 0.5,
      metrics: { lintPass: 1 },
      costUsd: 0.01,
      costBasis: 'api',
      recordedAt: '2026-09-29T10:00:00.000Z',
    });
  });

  it('recordFromRun copies a claude-cli route and its api-equivalent cost basis', () => {
    const r = recordFromRun('feedback-acceptance', 'c1', run({ anthropicVia: 'claude-cli', costBasis: 'api-equivalent' }), 1, {});
    expect(r).toMatchObject({ anthropicVia: 'claude-cli', costBasis: 'api-equivalent' });
  });

  it('parseEvalRecords returns the records written by appendEvalRecord', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'eval-results-'));
    const a = record({ caseId: 'c1' });
    const b = record({ caseId: 'c2', score: 0 });
    appendEvalRecord(a, dir);
    appendEvalRecord(b, dir);

    const written = readFileSync(path.join(dir, 'review-recall.jsonl'), 'utf8');
    expect(parseEvalRecords(written)).toEqual([a, b]);
  });

  it('parseEvalRecords skips blank lines and names the 1-based line of a malformed line', () => {
    const good = JSON.stringify(record());
    expect(parseEvalRecords(`${good}\n\n${good}\n`)).toHaveLength(2);
    expect(() => parseEvalRecords(`${good}\n{not json\n`)).toThrow(/line 2/);
  });

  it('latestRecords keeps only the newest record per (suite, model, effort, caseId)', () => {
    const older = record({ score: 0, recordedAt: '2026-09-29T09:00:00.000Z' });
    const newer = record({ score: 1, recordedAt: '2026-09-29T11:00:00.000Z' });
    const otherEffort = record({ effort: 'max', recordedAt: '2026-09-29T08:00:00.000Z' });

    const latest = latestRecords([newer, older, otherEffort]);
    expect(latest).toHaveLength(2);
    expect(latest).toContainEqual(newer);
    expect(latest).toContainEqual(otherEffort);
  });

  it('singleFamilyFinds lists a case found only by the anthropic family', () => {
    const records = [
      record({ caseId: 'c1', provider: 'anthropic', model: 'claude-sonnet-5-5', metrics: { recall: 1 } }),
      record({ caseId: 'c1', provider: 'openai', model: 'gpt-6-sol', metrics: { recall: 0 } }),
      record({ caseId: 'c2', provider: 'anthropic', model: 'claude-sonnet-5-5', metrics: { recall: 1 } }),
      record({ caseId: 'c2', provider: 'openai', model: 'gpt-6-sol', metrics: { recall: 1 } }),
    ];
    expect(singleFamilyFinds(records, 'review-recall', 'recall')).toEqual({ anthropic: ['c1'], openai: [] });
  });

  it('renderPlacementTable renders the header, n/a effort and n/a cost', () => {
    const table = renderPlacementTable([
      record({ model: 'claude-haiku-4-5', effort: null, costUsd: null }),
      record({ caseId: 'c2', model: 'claude-haiku-4-5', effort: null, costUsd: 0.02 }),
    ]);
    const lines = table.split('\n');
    expect(lines[0]).toBe('| Suite | Model | Effort | Cases | Mean score | Input tok | Output tok | Cost (USD) | Cost basis |');
    expect(lines[2]).toBe('| review-recall | claude-haiku-4-5 | n/a | 2 | 1.000 | 230 | 100 | n/a | api |');
    expect(table).toContain('### Review recall: blockers found by one family only');
  });

  it('renderPlacementTable sums cost when every record has one and sorts rows by suite then model', () => {
    const table = renderPlacementTable([
      record({ suite: 'review-recall', model: 'gpt-6-luna', provider: 'openai', costUsd: 0.5 }),
      record({ suite: 'plan-quality', model: 'claude-sonnet-5-5', costUsd: 0.25 }),
      record({ suite: 'review-recall', model: 'claude-opus-5-5', costUsd: 0.125 }),
    ]);
    const rows = table.split('\n').slice(2, 5);
    expect(rows[0]).toContain('| plan-quality | claude-sonnet-5-5 |');
    expect(rows[0]).toContain('| 0.2500 |');
    expect(rows[1]).toContain('| review-recall | claude-opus-5-5 |');
    expect(rows[2]).toContain('| review-recall | gpt-6-luna |');
  });

  it('renderPlacementTable reports recall, blocking recall and blocking severity per model, skipping legacy records', () => {
    const split = (recall: 0 | 1, blockingRecall: 0 | 1, excerptSufficient: 0 | 1 = 1) => ({
      recall,
      blockingRecall,
      blockingSeverity: recall ? blockingRecall : null,
      excerptSufficient,
    });
    const table = renderPlacementTable([
      record({ caseId: 'c1', model: 'claude-opus-5-5', metrics: split(1, 1) }),
      record({ caseId: 'c2', model: 'claude-opus-5-5', metrics: split(1, 0, 0) }),
      record({ caseId: 'c3', model: 'claude-opus-5-5', metrics: split(0, 0) }),
      record({ caseId: 'c1', model: 'claude-sonnet-5-5', effort: null, metrics: split(1, 0) }),
      // Legacy record: written before the split, so its `recall` meant blocking recall.
      record({ caseId: 'c2', model: 'claude-sonnet-5-5', effort: null, metrics: { recall: 1 } }),
    ]);
    const section = table.slice(table.indexOf('### Review recall: found vs rated blocking'));
    expect(section.split('\n').filter((l) => l.startsWith('- '))).toEqual([
      '- claude-opus-5-5 (high): recall 2/3; blocking recall 1/3; rated blocking when found 1/2; excerpt-sufficient recall 1/2',
      '- claude-sonnet-5-5 (n/a): recall 1/1; blocking recall 0/1; rated blocking when found 0/1; excerpt-sufficient recall 1/1',
    ]);
  });
});
