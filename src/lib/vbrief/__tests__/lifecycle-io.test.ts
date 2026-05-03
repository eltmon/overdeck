import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  deleteVBrief,
  findVBriefByIssue,
  moveVBrief,
  moveVBriefFilesOnly,
  updatePlanStatus,
} from '../lifecycle-io.js';
import {
  continueFilePath,
  writeContinueState,
  type ContinueState,
} from '../continue-state.js';
import {
  ensureVBriefDirs,
  generateVBriefFilename,
  resolveVBriefDir,
} from '../lifecycle.js';
import type { VBriefDocument } from '../types.js';

let TEST_DIR: string;
let isGitRepo = false;

function initGitRepo(dir: string): void {
  execSync('git init -q -b main', { cwd: dir });
  execSync('git config user.email test@test.local', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  // Ensure repo has at least one commit so HEAD is real
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execSync('git add README.md', { cwd: dir });
  execSync('git -c commit.gpgsign=false commit -q -m "init"', { cwd: dir });
  isGitRepo = true;
}

function makePlan(issueId: string, slug: string, status: string = 'proposed'): VBriefDocument {
  return {
    vBRIEFInfo: { version: '0.5', created: '2026-05-03T00:00:00Z' },
    plan: {
      id: issueId.toLowerCase(),
      title: `Plan for ${issueId}`,
      status,
      sequence: 1,
      created: '2026-05-03T00:00:00Z',
      items: [],
      edges: [],
    },
  };
}

function writePlan(dir: string, filename: string, doc: VBriefDocument): string {
  const p = join(dir, filename);
  writeFileSync(p, JSON.stringify(doc, null, 2), 'utf-8');
  return p;
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'vbrief-io-'));
  isGitRepo = false;
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('findVBriefByIssue', () => {
  it('finds a vBRIEF in proposed/', () => {
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-946', 'foo', '2026-05-03');
    writePlan(resolveVBriefDir(TEST_DIR, 'proposed'), filename, makePlan('PAN-946', 'foo'));
    const found = findVBriefByIssue(TEST_DIR, 'PAN-946');
    expect(found).not.toBeNull();
    expect(found?.lifecycleDir).toBe('proposed');
    expect(found?.issueId).toBe('PAN-946');
    expect(found?.slug).toBe('foo');
    expect(found?.document.plan.id).toBe('pan-946');
  });

  it('finds a vBRIEF in active/', () => {
    ensureVBriefDirs(TEST_DIR);
    writePlan(
      resolveVBriefDir(TEST_DIR, 'active'),
      generateVBriefFilename('PAN-100', 'bar', '2026-05-03'),
      makePlan('PAN-100', 'bar', 'approved'),
    );
    const found = findVBriefByIssue(TEST_DIR, 'PAN-100');
    expect(found?.lifecycleDir).toBe('active');
  });

  it('returns null when no vBRIEF exists', () => {
    ensureVBriefDirs(TEST_DIR);
    expect(findVBriefByIssue(TEST_DIR, 'PAN-999')).toBeNull();
  });

  it('prefers proposed/ over active/ when both contain a match', () => {
    ensureVBriefDirs(TEST_DIR);
    writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      generateVBriefFilename('PAN-1', 'foo', '2026-05-03'),
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    writePlan(
      resolveVBriefDir(TEST_DIR, 'active'),
      generateVBriefFilename('PAN-1', 'foo', '2026-05-03'),
      makePlan('PAN-1', 'foo', 'approved'),
    );
    const found = findVBriefByIssue(TEST_DIR, 'PAN-1');
    expect(found?.lifecycleDir).toBe('proposed');
  });

  it('ignores files that do not match the canonical naming convention', () => {
    ensureVBriefDirs(TEST_DIR);
    writeFileSync(
      join(resolveVBriefDir(TEST_DIR, 'proposed'), 'plan.vbrief.json'),
      JSON.stringify(makePlan('PAN-1', 'foo')),
    );
    expect(findVBriefByIssue(TEST_DIR, 'PAN-1')).toBeNull();
  });

  it('skips corrupt files matching the naming convention', () => {
    ensureVBriefDirs(TEST_DIR);
    writeFileSync(
      join(resolveVBriefDir(TEST_DIR, 'proposed'), generateVBriefFilename('PAN-1', 'corrupt', '2026-05-03')),
      'not valid json',
    );
    // Also write a valid one in active/
    writePlan(
      resolveVBriefDir(TEST_DIR, 'active'),
      generateVBriefFilename('PAN-1', 'good', '2026-05-03'),
      makePlan('PAN-1', 'good', 'approved'),
    );
    const found = findVBriefByIssue(TEST_DIR, 'PAN-1');
    expect(found?.lifecycleDir).toBe('active');
  });
});

describe('updatePlanStatus', () => {
  it('updates plan.status, increments sequence, refreshes timestamps', async () => {
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    const path = writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    await new Promise(r => setTimeout(r, 5));
    updatePlanStatus(path, 'approved');
    const after = JSON.parse(readFileSync(path, 'utf-8')) as VBriefDocument;
    expect(after.plan.status).toBe('approved');
    expect(after.plan.sequence).toBe(2);
    expect(after.plan.updated).toBeTruthy();
    expect(after.vBRIEFInfo.updated).toBeTruthy();
  });

  it('writes atomically (no .tmp left behind)', () => {
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    const path = writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    updatePlanStatus(path, 'approved');
    expect(existsSync(path + '.tmp')).toBe(false);
  });
});

describe('moveVBriefFilesOnly', () => {
  it('moves scope vBRIEF and continue file together', () => {
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    const oldPath = writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    const continueState: ContinueState = {
      version: '1',
      issueId: 'PAN-1',
      created: '2026-05-03T00:00:00Z',
      updated: '2026-05-03T00:00:00Z',
      gitState: {},
      decisions: [],
      hazards: [],
      resumePoint: null,
      beadsMapping: {},
      sessionHistory: [],
    };
    writeContinueState(resolveVBriefDir(TEST_DIR, 'proposed'), 'PAN-1', continueState);

    const result = moveVBriefFilesOnly(TEST_DIR, 'PAN-1', 'active');
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(result.toPath)).toBe(true);
    expect(result.toPath).toBe(join(resolveVBriefDir(TEST_DIR, 'active'), filename));
    expect(existsSync(continueFilePath(resolveVBriefDir(TEST_DIR, 'active'), 'PAN-1'))).toBe(true);
    expect(existsSync(continueFilePath(resolveVBriefDir(TEST_DIR, 'proposed'), 'PAN-1'))).toBe(false);
    expect(result.movedContinue).toBe(true);
  });

  it('handles missing continue file (no-op for continue)', () => {
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    const result = moveVBriefFilesOnly(TEST_DIR, 'PAN-1', 'active');
    expect(result.movedContinue).toBe(false);
    expect(existsSync(result.toPath)).toBe(true);
  });

  it('throws when the issue has no vBRIEF', () => {
    ensureVBriefDirs(TEST_DIR);
    expect(() => moveVBriefFilesOnly(TEST_DIR, 'PAN-999', 'active')).toThrow();
  });

  it('handles same source and target lifecycle dir as a no-op', () => {
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    const result = moveVBriefFilesOnly(TEST_DIR, 'PAN-1', 'proposed');
    expect(existsSync(result.toPath)).toBe(true);
  });
});

describe('moveVBrief (with git staging)', () => {
  it('moves and stages with git add', async () => {
    initGitRepo(TEST_DIR);
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    // First commit the proposed/ file so git knows about the source
    execSync('git add vbrief/', { cwd: TEST_DIR });
    execSync('git -c commit.gpgsign=false commit -q -m "add proposed"', { cwd: TEST_DIR });

    const result = await moveVBrief(TEST_DIR, 'PAN-1', 'active');
    expect(existsSync(result.toPath)).toBe(true);

    // Check git index reflects the move
    const status = execSync('git status --porcelain', { cwd: TEST_DIR, encoding: 'utf-8' });
    expect(status).toMatch(/vbrief\/active\//);
  });

  it('throws when issue has no vBRIEF', async () => {
    initGitRepo(TEST_DIR);
    ensureVBriefDirs(TEST_DIR);
    await expect(moveVBrief(TEST_DIR, 'PAN-999', 'active')).rejects.toThrow();
  });
});

describe('deleteVBrief', () => {
  it('deletes scope vBRIEF and continue file', () => {
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    const path = writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    writeContinueState(resolveVBriefDir(TEST_DIR, 'proposed'), 'PAN-1', {
      version: '1',
      issueId: 'PAN-1',
      created: '2026-05-03T00:00:00Z',
      updated: '2026-05-03T00:00:00Z',
      gitState: {},
      decisions: [],
      hazards: [],
      resumePoint: null,
      beadsMapping: {},
      sessionHistory: [],
    });
    expect(deleteVBrief(TEST_DIR, 'PAN-1')).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(continueFilePath(resolveVBriefDir(TEST_DIR, 'proposed'), 'PAN-1'))).toBe(false);
  });

  it('returns false when issue has no vBRIEF', () => {
    ensureVBriefDirs(TEST_DIR);
    expect(deleteVBrief(TEST_DIR, 'PAN-999')).toBe(false);
  });
});
