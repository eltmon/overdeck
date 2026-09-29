import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  appendContinueSessionEntryForIssue,
  appendFeedbackEntryForIssue,
  clearFeedbackForIssue,
  findXBriefByIssueSync,
  readContinueStateForIssue,
  transitionIssueXBrief,
  updatePlanStatus,
} from '../lifecycle-io.js';
import {
  ensureXBriefDirs,
  generateXBriefFilename,
  resolveXBriefDir,
} from '../lifecycle.js';
import { continueStatePath, writeContinueState, type ContinueState } from '../continue-state.js';
import type { XBriefDocument } from '../types.js';

let TEST_DIR: string;

function makePlan(issueId: string, slug: string, status: string = 'proposed'): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.5', created: '2026-05-03T00:00:00Z' },
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

function writePlan(dir: string, filename: string, doc: XBriefDocument): string {
  const p = join(dir, filename);
  writeFileSync(p, JSON.stringify(doc, undefined, 2), 'utf-8');
  return p;
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'xbrief-io-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('findXBriefByIssue', () => {
  it('finds an xBRIEF in proposed/', () => {
    ensureXBriefDirs(TEST_DIR);
    const filename = generateXBriefFilename('PAN-946', 'foo', '2026-05-03');
    writePlan(resolveXBriefDir(TEST_DIR, 'proposed'), filename, makePlan('PAN-946', 'foo'));
    const found = findXBriefByIssueSync(TEST_DIR, 'PAN-946');
    expect(found).not.toBeNull();
    expect(found?.lifecycleDir).toBe('proposed');
    expect(found?.issueId).toBe('PAN-946');
    expect(found?.slug).toBe('foo');
    expect(found?.document.plan.id).toBe('pan-946');
  });

  it('finds an xBRIEF in active/', () => {
    ensureXBriefDirs(TEST_DIR);
    writePlan(
      resolveXBriefDir(TEST_DIR, 'active'),
      generateXBriefFilename('PAN-100', 'bar', '2026-05-03'),
      makePlan('PAN-100', 'bar', 'approved'),
    );
    const found = findXBriefByIssueSync(TEST_DIR, 'PAN-100');
    expect(found?.lifecycleDir).toBe('active');
  });

  it('returns null when no xBRIEF exists', () => {
    ensureXBriefDirs(TEST_DIR);
    expect(findXBriefByIssueSync(TEST_DIR, 'PAN-999')).toBeNull();
  });

  it('prefers proposed/ over active/ when both contain a match', () => {
    ensureXBriefDirs(TEST_DIR);
    writePlan(
      resolveXBriefDir(TEST_DIR, 'proposed'),
      generateXBriefFilename('PAN-1', 'foo', '2026-05-03'),
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    writePlan(
      resolveXBriefDir(TEST_DIR, 'active'),
      generateXBriefFilename('PAN-1', 'foo', '2026-05-03'),
      makePlan('PAN-1', 'foo', 'approved'),
    );
    const found = findXBriefByIssueSync(TEST_DIR, 'PAN-1');
    expect(found?.lifecycleDir).toBe('proposed');
  });

  it('ignores files that do not match the canonical naming convention', () => {
    ensureXBriefDirs(TEST_DIR);
    writeFileSync(
      join(resolveXBriefDir(TEST_DIR, 'proposed'), 'plan.vbrief.json'),
      JSON.stringify(makePlan('PAN-1', 'foo')),
    );
    expect(findXBriefByIssueSync(TEST_DIR, 'PAN-1')).toBeNull();
  });

  it('skips corrupt files matching the naming convention', () => {
    ensureXBriefDirs(TEST_DIR);
    writeFileSync(
      join(resolveXBriefDir(TEST_DIR, 'proposed'), generateXBriefFilename('PAN-1', 'corrupt', '2026-05-03')),
      'not valid json',
    );
    // Also write a valid one in active/
    writePlan(
      resolveXBriefDir(TEST_DIR, 'active'),
      generateXBriefFilename('PAN-1', 'good', '2026-05-03'),
      makePlan('PAN-1', 'good', 'approved'),
    );
    const found = findXBriefByIssueSync(TEST_DIR, 'PAN-1');
    expect(found?.lifecycleDir).toBe('active');
  });
});

describe('updatePlanStatus', () => {
  it('updates plan.status, increments sequence, refreshes timestamps', async () => {
    ensureXBriefDirs(TEST_DIR);
    const filename = generateXBriefFilename('PAN-1', 'foo', '2026-05-03');
    const path = writePlan(
      resolveXBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    await new Promise(r => setTimeout(r, 5));
    updatePlanStatus(path, 'approved');
    const after = JSON.parse(readFileSync(path, 'utf-8')) as XBriefDocument;
    expect(after.plan.status).toBe('approved');
    expect(after.plan.sequence).toBe(2);
    expect(after.plan.updated).toBeTruthy();
    expect(after.xBRIEFInfo.updated).toBeTruthy();
  });

  it('writes atomically (no .tmp left behind)', () => {
    ensureXBriefDirs(TEST_DIR);
    const filename = generateXBriefFilename('PAN-1', 'foo', '2026-05-03');
    const path = writePlan(
      resolveXBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    updatePlanStatus(path, 'approved');
    expect(existsSync(path + '.tmp')).toBe(false);
  });
});


describe('transitionIssueXBrief', () => {
  it('moves xBRIEF between dirs and updates status (ac2)', async () => {
    ensureXBriefDirs(TEST_DIR);
    const filename = generateXBriefFilename('PAN-7', 'foo', '2026-05-03');
    writePlan(
      resolveXBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-7', 'foo', 'proposed'),
    );

    const result = await transitionIssueXBrief(TEST_DIR, 'PAN-7', 'active', 'running');

    expect(result.fromDir).toBe('proposed');
    expect(result.toDir).toBe('active');
    expect(result.moved).toBe(true);
    expect(result.statusUpdated).toBe(true);
    expect(existsSync(result.toPath)).toBe(true);
    expect(existsSync(join(resolveXBriefDir(TEST_DIR, 'proposed'), filename))).toBe(false);

    const updatedDoc = JSON.parse(readFileSync(result.toPath, 'utf-8')) as XBriefDocument;
    expect(updatedDoc.plan.status).toBe('running');
    expect(updatedDoc.plan.sequence).toBe(2);
  });

  it('a second identical call is a no-op (ac3)', async () => {
    ensureXBriefDirs(TEST_DIR);
    const filename = generateXBriefFilename('PAN-7', 'foo', '2026-05-03');
    writePlan(
      resolveXBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-7', 'foo', 'proposed'),
    );

    await transitionIssueXBrief(TEST_DIR, 'PAN-7', 'active', 'running');
    const second = await transitionIssueXBrief(TEST_DIR, 'PAN-7', 'active', 'running');

    expect(second.moved).toBe(false);
    expect(second.statusUpdated).toBe(false);
  });

  it('is idempotent once the issue already lives in .pan/specs with the target lifecycle and status', async () => {
    const filename = generateXBriefFilename('PAN-1', 'foo', '2026-05-03');
    const migratedPath = join(TEST_DIR, '.pan', 'specs', filename);
    mkdirSync(join(TEST_DIR, '.pan', 'specs'), { recursive: true });
    writeFileSync(
      migratedPath,
      JSON.stringify({
        ...makePlan('PAN-1', 'foo', 'approved'),
        status: 'active',
      }, null, 2),
      'utf-8',
    );

    const result = await transitionIssueXBrief(TEST_DIR, 'PAN-1', 'active', 'approved');

    expect(result.moved).toBe(false);
    expect(result.statusUpdated).toBe(false);
    expect(result.toPath).toBe(migratedPath);
  });

  it('updates status only when already in target dir but status differs', async () => {
    ensureXBriefDirs(TEST_DIR);
    const filename = generateXBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
      resolveXBriefDir(TEST_DIR, 'active'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'), // wrong status
    );

    const result = await transitionIssueXBrief(TEST_DIR, 'PAN-1', 'active', 'approved');

    expect(result.moved).toBe(false);
    expect(result.statusUpdated).toBe(true);

    const doc = JSON.parse(readFileSync(result.toPath, 'utf-8')) as XBriefDocument;
    expect(doc.plan.status).toBe('approved');
  });

  it('throws when no xBRIEF exists for the issue', async () => {
    ensureXBriefDirs(TEST_DIR);
    await expect(transitionIssueXBrief(TEST_DIR, 'PAN-999', 'active', 'approved')).rejects.toThrow();
  });

  it('runs no git command — works on a plan home that is not a git repository (ac4)', async () => {
    ensureXBriefDirs(TEST_DIR);
    const filename = generateXBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
      resolveXBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );

    await expect(transitionIssueXBrief(TEST_DIR, 'PAN-1', 'active', 'approved')).resolves.toMatchObject({
      moved: true,
      statusUpdated: true,
    });
  });

  it('creates no vbrief/ directory on a plan home that lacks one (ac5)', async () => {
    mkdirSync(join(TEST_DIR, '.pan', 'specs'), { recursive: true });
    writeFileSync(
      join(TEST_DIR, '.pan', 'specs', generateXBriefFilename('PAN-1', 'foo', '2026-05-03')),
      JSON.stringify(makePlan('PAN-1', 'foo', 'proposed'), null, 2),
      'utf-8',
    );

    await transitionIssueXBrief(TEST_DIR, 'PAN-1', 'active', 'approved');

    expect(existsSync(join(TEST_DIR, 'vbrief'))).toBe(false);
  });
});

describe('per-issue continue adapters (PAN-4225)', () => {
  const issueId = 'PAN-1919';
  const workspaceDir = () => join(TEST_DIR, 'workspaces', 'feature-pan-1919');
  const workspaceContinuePath = () => continueStatePath(workspaceDir(), issueId);
  const primaryContinuePath = () => continueStatePath(TEST_DIR, issueId);

  function seedContinueState(planHome: string, overrides: Partial<ContinueState> = {}): void {
    const now = new Date().toISOString();
    writeContinueState(planHome, issueId, {
      version: '1',
      issueId,
      created: now,
      updated: now,
      gitState: {},
      decisions: [],
      hazards: [],
      resumePoint: null,
      sessionHistory: [],
      ...overrides,
    });
  }

  it('ac1: writes into the workspace plan home and never the primary checkout', () => {
    mkdirSync(workspaceDir(), { recursive: true });

    const wrote = appendContinueSessionEntryForIssue(TEST_DIR, issueId, {
      reason: 'manual',
      note: 'seeded for ac1',
    });

    expect(wrote).toBe(true);
    expect(existsSync(workspaceContinuePath())).toBe(true);
    expect(existsSync(join(TEST_DIR, '.pan'))).toBe(false);
  });

  it('ac2: returns false and writes nothing when there is no base workspace', () => {
    const wrote = appendFeedbackEntryForIssue(TEST_DIR, issueId, {
      seq: 1,
      specialist: 'review-agent',
      outcome: 'changes-requested',
      timestamp: new Date().toISOString(),
      markdownBody: '# feedback',
    });

    expect(wrote).toBe(false);
    expect(existsSync(workspaceDir())).toBe(false);
    expect(existsSync(join(TEST_DIR, '.pan'))).toBe(false);
  });

  it('ac3: returns false and creates no continue file when the workspace has none yet', () => {
    mkdirSync(workspaceDir(), { recursive: true });

    const cleared = clearFeedbackForIssue(TEST_DIR, issueId);

    expect(cleared).toBe(false);
    expect(existsSync(workspaceContinuePath())).toBe(false);
  });

  it('ac4: readContinueStateForIssue prefers the workspace copy, falls back to the primary', () => {
    mkdirSync(workspaceDir(), { recursive: true });
    seedContinueState(workspaceDir(), { resumePoint: { description: 'workspace copy' } });
    seedContinueState(TEST_DIR, { resumePoint: { description: 'primary copy' } });

    const preferred = readContinueStateForIssue(TEST_DIR, issueId);
    expect(preferred?.resumePoint?.description).toBe('workspace copy');

    rmSync(workspaceContinuePath());
    expect(existsSync(primaryContinuePath())).toBe(true);

    const fallback = readContinueStateForIssue(TEST_DIR, issueId);
    expect(fallback?.resumePoint?.description).toBe('primary copy');
  });
});
