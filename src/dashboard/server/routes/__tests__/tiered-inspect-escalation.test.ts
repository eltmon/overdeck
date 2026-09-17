import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { loadConfigSync } from '../../../../lib/config-yaml.js';
import { readTierOverrides, readTierRetries } from '../../../../lib/xbrief/io.js';
import type { XBriefDifficulty, XBriefDocument, XBriefItem } from '../../../../lib/xbrief/types.js';
import {
  handleTieredInspectFailureEscalation,
  type TieredInspectFailureEscalationDeps,
} from '../tiered-inspect-escalation.js';

const ISSUE_ID = 'PAN-9999';
const NOTES = 'Supervisor BLOCKED commit abc123 — Bead item-1';

let projectRoot: string;
let workspacePath: string;

function planItem(id: string, difficulty: XBriefDifficulty): XBriefItem {
  return { id, title: id, status: 'pending', metadata: { difficulty } };
}

function planDoc(items: XBriefItem[]): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.6', created: '2026-09-17T00:00:00Z' },
    plan: {
      id: 'plan-1',
      title: 'test plan',
      status: 'running',
      metadata: {},
      items,
      edges: [],
    },
  };
}

function escalationConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    retries_at_tier: 1,
    max_promotions: 2,
    ...overrides,
  } as never;
}

function deps(items: XBriefItem[], escalation: Record<string, unknown> = {}): TieredInspectFailureEscalationDeps {
  return {
    loadConfig: (() => ({
      config: {
        tieredExecution: {
          enabled: true,
          escalation: escalationConfig(escalation),
        },
      },
    })) as unknown as typeof loadConfigSync,
    resolveProject: (() => ({ projectPath: projectRoot })) as never,
    readPlan: (() => planDoc(items)) as never,
    readReviewedCommit: () => 'abc123',
  };
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'tiered-escalation-'));
  workspacePath = join(projectRoot, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
  mkdirSync(workspacePath, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('handleTieredInspectFailureEscalation (PAN-3858 retry attempts)', () => {
  it('first supervisor-blocked failure with retries_at_tier: 1 returns retry and records the attempt', () => {
    const decision = handleTieredInspectFailureEscalation(ISSUE_ID, NOTES, deps([planItem('item-1', 'simple')]));

    expect(decision).toEqual({ action: 'retry', attempt: 1 });
    expect(readTierRetries(workspacePath)['item-1']).toEqual({ difficulty: 'simple', attempts: 1 });
    expect(readTierOverrides(workspacePath)).toEqual({});
  });

  it('second supervisor-blocked failure with retries_at_tier: 1 returns promote and clears the retry count', () => {
    const itemDeps = deps([planItem('item-1', 'simple')]);
    expect(handleTieredInspectFailureEscalation(ISSUE_ID, NOTES, itemDeps)).toEqual({ action: 'retry', attempt: 1 });

    const decision = handleTieredInspectFailureEscalation(ISSUE_ID, NOTES, itemDeps);
    expect(decision).toMatchObject({ action: 'promote', from: 'simple', to: 'medium' });

    expect(readTierOverrides(workspacePath)['item-1']).toMatchObject({ effectiveDifficulty: 'medium', promotions: 1 });
    expect(readTierRetries(workspacePath)['item-1']).toBeUndefined();
  });

  it('treats a recorded retry at a different difficulty as zero attempts', () => {
    const itemDeps = deps([planItem('item-1', 'simple')]);
    expect(handleTieredInspectFailureEscalation(ISSUE_ID, NOTES, itemDeps)).toEqual({ action: 'retry', attempt: 1 });

    // The plan changed under the recorded retry: item is now medium, so the
    // recorded attempt at simple no longer counts.
    const changedDeps = deps([planItem('item-1', 'medium')]);
    expect(handleTieredInspectFailureEscalation(ISSUE_ID, NOTES, changedDeps)).toEqual({ action: 'retry', attempt: 1 });
    expect(readTierRetries(workspacePath)['item-1']).toEqual({ difficulty: 'medium', attempts: 1 });
  });

  it('retries_at_tier: 0 promotes on the first failure (default behavior preserved)', () => {
    const decision = handleTieredInspectFailureEscalation(
      ISSUE_ID,
      NOTES,
      deps([planItem('item-1', 'simple')], { retries_at_tier: 0 }),
    );
    expect(decision).toMatchObject({ action: 'promote', from: 'simple', to: 'medium' });
    expect(readTierRetries(workspacePath)).toEqual({});
  });
});
