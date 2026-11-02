/**
 * The adopted-workspace plan checklist skip (PAN-4786).
 *
 * An adopted PR workspace (PAN-4605) has no xBRIEF, so the plan checklist gate
 * would always fail it. `withAdoptedPlanChecklistSkip` sets `skipPlanChecklist`
 * for exactly that case and leaves every other workspace's options untouched.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isAdoptedWorkspaceWithoutPlan,
  withAdoptedPlanChecklistSkip,
} from '../../../../src/lib/cloister/adopted-plan-checklist.js';

let root: string;
let workspacePath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pan-4786-'));
  workspacePath = join(root, 'workspaces', 'feature-pan-9001');
  await mkdir(workspacePath, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeJournal(lines: Array<Record<string, unknown>>): Promise<void> {
  const journalDir = join(workspacePath, '.overdeck');
  await mkdir(journalDir, { recursive: true });
  const body = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
  await writeFile(join(journalDir, 'pipeline.jsonl'), body, 'utf-8');
}

function adoptedEntry(): Record<string, unknown> {
  return { at: '2026-11-02T04:21:00.000Z', type: 'workspace.adopted', issueId: 'PAN-9001', source: 'pr-adoption', data: { prNumber: 1 } };
}

async function writeSpec(root: string): Promise<void> {
  await mkdir(join(root, '.pan', 'specs'), { recursive: true });
  await writeFile(join(root, '.pan', 'specs', '2026-11-01-PAN-9001-adopted.xbrief.json'), '{}', 'utf-8');
}

describe('isAdoptedWorkspaceWithoutPlan / withAdoptedPlanChecklistSkip', () => {
  it('case 1: adopted, no plan anywhere — skips the checklist', async () => {
    await writeJournal([adoptedEntry()]);

    expect(await isAdoptedWorkspaceWithoutPlan(workspacePath)).toBe(true);
    expect(await withAdoptedPlanChecklistSkip(workspacePath, {})).toEqual({ skipPlanChecklist: true });
  });

  it('case 2: adopted, spec in the workspace — leaves options unchanged', async () => {
    await writeJournal([adoptedEntry()]);
    await writeSpec(workspacePath);

    expect(await isAdoptedWorkspaceWithoutPlan(workspacePath)).toBe(false);
    expect(await withAdoptedPlanChecklistSkip(workspacePath, {})).toEqual({});
  });

  it('case 3: adopted, spec merged on main (the main checkout) — leaves options unchanged', async () => {
    await writeJournal([adoptedEntry()]);
    await writeSpec(root);

    expect(await isAdoptedWorkspaceWithoutPlan(workspacePath)).toBe(false);
    expect(await withAdoptedPlanChecklistSkip(workspacePath, {})).toEqual({});
  });

  it('case 4: journal holds only review.requested, no plan — leaves options unchanged', async () => {
    await writeJournal([{ at: '2026-11-02T04:22:00.000Z', type: 'review.requested', issueId: 'PAN-9001', source: 'pan-done' }]);

    expect(await isAdoptedWorkspaceWithoutPlan(workspacePath)).toBe(false);
    expect(await withAdoptedPlanChecklistSkip(workspacePath, {})).toEqual({});
  });

  it('case 5: no journal file at all — leaves options unchanged', async () => {
    expect(await isAdoptedWorkspaceWithoutPlan(workspacePath)).toBe(false);
    expect(await withAdoptedPlanChecklistSkip(workspacePath, {})).toEqual({});
  });

  it('case 6: skipPlanChecklist already true — same object identity, no journal read', async () => {
    const options = { skipPlanChecklist: true, syncTargetBranch: false };

    const resolved = await withAdoptedPlanChecklistSkip('/nonexistent/workspaces/feature-pan-9001', options);

    expect(resolved).toBe(options);
  });

  it('case 7: adopted entry is not the last entry, no plan — still skips the checklist', async () => {
    await writeJournal([
      adoptedEntry(),
      { at: '2026-11-02T04:23:00.000Z', type: 'review.requested', issueId: 'PAN-9001', source: 'pan-done' },
      { at: '2026-11-02T04:24:00.000Z', type: 'verification.failed', issueId: 'PAN-9001', source: 'pan-done' },
    ]);

    expect(await isAdoptedWorkspaceWithoutPlan(workspacePath)).toBe(true);
    expect(await withAdoptedPlanChecklistSkip(workspacePath, {})).toEqual({ skipPlanChecklist: true });
  });

  it('case 8: only a failed adoption (workspace-head-mismatch), no plan — skips the checklist (PAN-4810)', async () => {
    await writeJournal([{
      at: '2026-11-02T06:15:00.000Z', type: 'workspace.adoption-failed', issueId: 'PAN-9001', source: 'pr-adoption',
      data: { prNumber: 1, reason: 'workspace-head-mismatch' },
    }]);

    expect(await isAdoptedWorkspaceWithoutPlan(workspacePath)).toBe(true);
    expect(await withAdoptedPlanChecklistSkip(workspacePath, {})).toEqual({ skipPlanChecklist: true });
  });

  it('case 9: a feedback-only continues file from a failed run is not a plan (PAN-4810)', async () => {
    await writeJournal([adoptedEntry()]);
    const feedbackOnly = JSON.stringify({
      version: '1', issueId: 'PAN-9001', sessionHistory: [], feedback: [{ seq: 1, specialist: 'verification-gate', outcome: 'failed' }],
    });
    for (const dir of [workspacePath, root]) {
      await mkdir(join(dir, '.pan', 'continues'), { recursive: true });
      await writeFile(join(dir, '.pan', 'continues', 'PAN-9001.xbrief.json'), feedbackOnly, 'utf-8');
    }

    expect(await isAdoptedWorkspaceWithoutPlan(workspacePath)).toBe(true);
  });
});
