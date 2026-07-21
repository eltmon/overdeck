import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getIssueStageSync,
  isTerminalIssueStage,
} from '../agents.js';
import {
  closeOverdeckDatabaseSync,
  getOverdeckDatabaseSync,
} from '../infra.js';

describe('agent issue stage helpers', () => {
  const originalOverdeckHome = process.env.OVERDECK_HOME;
  let testHome: string;

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'agents-issue-stage-'));
    process.env.OVERDECK_HOME = testHome;
    closeOverdeckDatabaseSync();
  });

  afterEach(() => {
    closeOverdeckDatabaseSync();
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    rmSync(testHome, { recursive: true, force: true });
  });

  it('returns the stored issue stage or null when the issue is absent', () => {
    const db = getOverdeckDatabaseSync();
    db.prepare(`
      INSERT INTO issues (id, stage, updated_at)
      VALUES (?, ?, ?)
    `).run('PAN-2338', 'working', Date.now());

    expect(getIssueStageSync('PAN-2338')).toBe('working');
    expect(getIssueStageSync('PAN-404')).toBeNull();
  });

  it('identifies terminal issue stages', () => {
    expect(isTerminalIssueStage('verifying_on_main')).toBe(true);
    expect(isTerminalIssueStage('closed')).toBe(true);
    expect(isTerminalIssueStage('cancelled')).toBe(true);
    expect(isTerminalIssueStage('working')).toBe(false);
    expect(isTerminalIssueStage('planned')).toBe(false);
    expect(isTerminalIssueStage(null)).toBe(false);
  });
});
