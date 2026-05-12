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
  promoteVBriefToProposed,
  transitionVBriefOnMain,
  updatePlanStatus,
} from '../lifecycle-io.js';
import {
  continueFilePath,
  writeContinueState,
  type ContinueState,
} from '../continue-state.js';
import { getContinueFilePath } from '../../pan-dir/continues.js';
import {
  ensureVBriefDirs,
  generateVBriefFilename,
  resolveVBriefDir,
} from '../lifecycle.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME, PAN_SPEC_FILENAME } from '../../pan-dir/index.js';
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
    writeContinueState(TEST_DIR, 'PAN-1', continueState);

    const result = moveVBriefFilesOnly(TEST_DIR, 'PAN-1', 'active');
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(result.toPath)).toBe(true);
    expect(result.toPath).toBe(join(TEST_DIR, '.pan', 'specs', filename));
    // Continue file lives at canonical path; lifecycle dir move has no effect on it
    expect(existsSync(getContinueFilePath(TEST_DIR, 'pan-1'))).toBe(true);

    const movedDoc = JSON.parse(readFileSync(result.toPath, 'utf-8')) as VBriefDocument & { status: string };
    expect(movedDoc.status).toBe('active');
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

    // Check git index reflects the migration to canonical .pan/specs storage
    const status = execSync('git status --porcelain', { cwd: TEST_DIR, encoding: 'utf-8' });
    expect(status).toMatch(/\.pan\/specs\//);
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
    writeContinueState(TEST_DIR, 'PAN-1', {
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
    expect(existsSync(getContinueFilePath(TEST_DIR, 'pan-1'))).toBe(false);
  });

  it('returns false when issue has no vBRIEF', () => {
    ensureVBriefDirs(TEST_DIR);
    expect(deleteVBrief(TEST_DIR, 'PAN-999')).toBe(false);
  });
});

describe('promoteVBriefToProposed', () => {
  function createWorkspace(workspacePath: string, plan: VBriefDocument): void {
    const panDir = join(workspacePath, PAN_DIRNAME);
    mkdirSync(panDir, { recursive: true });
    writeFileSync(
      join(panDir, PAN_SPEC_FILENAME),
      JSON.stringify(plan, null, 2),
      'utf-8',
    );
  }

  it('throws when workspace plan is missing', () => {
    const workspacePath = join(TEST_DIR, 'workspaces', 'feature-pan-1');
    mkdirSync(workspacePath, { recursive: true });
    expect(() => promoteVBriefToProposed(workspacePath, TEST_DIR, 'PAN-1')).toThrow(
      /No workspace spec found/,
    );
  });

  it('copies vBRIEF using stamped canonicalFilename when present', () => {
    const workspacePath = join(TEST_DIR, 'workspaces', 'feature-pan-1');
    const plan = makePlan('PAN-1', 'foo');
    plan.plan.metadata = { canonicalFilename: '2026-05-03-PAN-1-foo.vbrief.json' };
    createWorkspace(workspacePath, plan);

    const result = promoteVBriefToProposed(workspacePath, TEST_DIR, 'PAN-1');

    expect(result.canonicalFilename).toBe('2026-05-03-PAN-1-foo.vbrief.json');
    expect(result.destVBrief).toBe(
      join(TEST_DIR, '.pan', 'specs', '2026-05-03-PAN-1-foo.vbrief.json'),
    );
    expect(result.destContinue).toBeNull();
    expect(existsSync(result.destVBrief)).toBe(true);
    const copied = JSON.parse(readFileSync(result.destVBrief, 'utf-8')) as VBriefDocument & { status: string };
    expect(copied.plan.id).toBe('pan-1');
    expect(copied.status).toBe('proposed');
  });

  it('generates canonical filename from plan title when metadata is absent', () => {
    const workspacePath = join(TEST_DIR, 'workspaces', 'feature-pan-2');
    const plan = makePlan('PAN-2', 'fallback');
    plan.plan.title = 'Adopt deft vBRIEF Lifecycle Model';
    // No metadata.canonicalFilename
    createWorkspace(workspacePath, plan);

    const result = promoteVBriefToProposed(workspacePath, TEST_DIR, 'PAN-2');

    expect(result.canonicalFilename).toMatch(
      /^\d{4}-\d{2}-\d{2}-PAN-2-adopt-deft-vbrief-lifecycle-model\.vbrief\.json$/,
    );
    expect(existsSync(result.destVBrief)).toBe(true);
  });

  it('uppercases issue ID for filename even when caller passes lowercase', () => {
    const workspacePath = join(TEST_DIR, 'workspaces', 'feature-pan-3');
    const plan = makePlan('PAN-3', 'lowercase-test');
    createWorkspace(workspacePath, plan);

    const result = promoteVBriefToProposed(workspacePath, TEST_DIR, 'pan-3');

    // generateVBriefFilename rejects lowercase issueId in its regex, so we verify
    // the filename has uppercase PAN-3.
    expect(result.canonicalFilename).toMatch(/PAN-3/);
  });

  it('copies continue file when present', () => {
    const workspacePath = join(TEST_DIR, 'workspaces', 'feature-pan-4');
    const plan = makePlan('PAN-4', 'with-continue');
    plan.plan.metadata = { canonicalFilename: '2026-05-03-PAN-4-with-continue.vbrief.json' };
    createWorkspace(workspacePath, plan);

    // Write a continue file in the workspace .pan/
    const continueFileName = 'continue-PAN-4.vbrief.json';
    const continueContent: ContinueState = {
      version: '1',
      issueId: 'PAN-4',
      created: '2026-05-03T00:00:00Z',
      updated: '2026-05-03T00:00:00Z',
      gitState: { branch: 'feature/pan-4', sha: 'abc123', dirty: false },
      decisions: [],
      hazards: [],
      resumePoint: null,
      beadsMapping: {},
      sessionHistory: [],
    };
    writeFileSync(
      join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME),
      JSON.stringify(continueContent, null, 2),
      'utf-8',
    );

    const result = promoteVBriefToProposed(workspacePath, TEST_DIR, 'PAN-4');

    expect(result.destContinue).toBe(getContinueFilePath(TEST_DIR, 'pan-4'));
    expect(existsSync(result.destContinue!)).toBe(true);
    const copied = JSON.parse(readFileSync(result.destContinue!, 'utf-8'));
    expect(copied.issueId).toBe('PAN-4');
  });

  it('returns destContinue null when continue file is absent', () => {
    const workspacePath = join(TEST_DIR, 'workspaces', 'feature-pan-5');
    const plan = makePlan('PAN-5', 'no-continue');
    plan.plan.metadata = { canonicalFilename: '2026-05-03-PAN-5-no-continue.vbrief.json' };
    createWorkspace(workspacePath, plan);

    const result = promoteVBriefToProposed(workspacePath, TEST_DIR, 'PAN-5');

    expect(result.destContinue).toBeNull();
    expect(existsSync(getContinueFilePath(TEST_DIR, 'pan-5'))).toBe(false);
  });

  it('creates canonical .pan/specs storage if it does not exist yet', () => {
    const workspacePath = join(TEST_DIR, 'workspaces', 'feature-pan-6');
    const plan = makePlan('PAN-6', 'first-promotion');
    plan.plan.metadata = { canonicalFilename: '2026-05-03-PAN-6-first-promotion.vbrief.json' };
    createWorkspace(workspacePath, plan);

    expect(existsSync(join(TEST_DIR, '.pan', 'specs'))).toBe(false);
    expect(existsSync(join(TEST_DIR, 'vbrief', 'proposed'))).toBe(false);

    promoteVBriefToProposed(workspacePath, TEST_DIR, 'PAN-6');

    expect(existsSync(join(TEST_DIR, '.pan', 'specs'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.pan', 'specs', '2026-05-03-PAN-6-first-promotion.vbrief.json'))).toBe(true);
    expect(existsSync(join(TEST_DIR, 'vbrief', 'proposed'))).toBe(false);
  });

  it('overwrites existing destination file (idempotent re-runs)', () => {
    const workspacePath = join(TEST_DIR, 'workspaces', 'feature-pan-7');
    const plan = makePlan('PAN-7', 'overwrite-test');
    plan.plan.metadata = { canonicalFilename: '2026-05-03-PAN-7-overwrite-test.vbrief.json' };
    createWorkspace(workspacePath, plan);

    promoteVBriefToProposed(workspacePath, TEST_DIR, 'PAN-7');

    // Modify the workspace plan and re-run promotion
    plan.plan.title = 'Updated title';
    writeFileSync(
      join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME),
      JSON.stringify(plan, null, 2),
      'utf-8',
    );

    const result = promoteVBriefToProposed(workspacePath, TEST_DIR, 'PAN-7');

    const copied = JSON.parse(readFileSync(result.destVBrief, 'utf-8'));
    expect(copied.plan.title).toBe('Updated title');
  });
});

describe('transitionVBriefOnMain', () => {
  it('moves vBRIEF between dirs, updates status, and commits on main', async () => {
    initGitRepo(TEST_DIR);
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    execSync('git add vbrief/', { cwd: TEST_DIR });
    execSync('git -c commit.gpgsign=false commit -q -m "add proposed"', { cwd: TEST_DIR });

    const result = await transitionVBriefOnMain(
      TEST_DIR,
      'PAN-1',
      'active',
      'approved',
      'scope: approve PAN-1 vBRIEF',
    );

    expect(result.fromDir).toBe('proposed');
    expect(result.toDir).toBe('active');
    expect(result.moved).toBe(true);
    expect(result.statusUpdated).toBe(true);
    expect(result.committed).toBe(true);
    expect(existsSync(result.toPath)).toBe(true);
    expect(existsSync(join(resolveVBriefDir(TEST_DIR, 'proposed'), filename))).toBe(false);

    const updatedDoc = JSON.parse(readFileSync(result.toPath, 'utf-8')) as VBriefDocument;
    expect(updatedDoc.plan.status).toBe('approved');
    expect(updatedDoc.plan.sequence).toBe(2);

    const log = execSync('git log -1 --pretty=%s', { cwd: TEST_DIR, encoding: 'utf-8' }).trim();
    expect(log).toBe('scope: approve PAN-1 vBRIEF');
  });

  it('is idempotent once the issue already lives in .pan/specs with the target lifecycle and status', async () => {
    initGitRepo(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
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
    execSync('git add .pan/specs/', { cwd: TEST_DIR });
    execSync('git -c commit.gpgsign=false commit -q -m "seed pan spec"', { cwd: TEST_DIR });

    const result = await transitionVBriefOnMain(
      TEST_DIR,
      'PAN-1',
      'active',
      'approved',
      'scope: approve PAN-1 vBRIEF',
    );

    expect(result.moved).toBe(false);
    expect(result.statusUpdated).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.toPath).toBe(migratedPath);

    const logCount = execSync('git rev-list --count HEAD', { cwd: TEST_DIR, encoding: 'utf-8' }).trim();
    expect(logCount).toBe('2');
  });

  it('updates status only when already in target dir but status differs', async () => {
    initGitRepo(TEST_DIR);
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
      resolveVBriefDir(TEST_DIR, 'active'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'), // wrong status
    );
    execSync('git add vbrief/', { cwd: TEST_DIR });
    execSync('git -c commit.gpgsign=false commit -q -m "seed active proposed"', { cwd: TEST_DIR });

    const result = await transitionVBriefOnMain(
      TEST_DIR,
      'PAN-1',
      'active',
      'approved',
      'scope: approve PAN-1 vBRIEF',
    );

    expect(result.moved).toBe(false);
    expect(result.statusUpdated).toBe(true);
    expect(result.committed).toBe(true);

    const doc = JSON.parse(readFileSync(result.toPath, 'utf-8')) as VBriefDocument;
    expect(doc.plan.status).toBe('approved');
  });

  it('leaves continue file at canonical path during lifecycle transitions', async () => {
    initGitRepo(TEST_DIR);
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
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
    writeContinueState(TEST_DIR, 'PAN-1', continueState);
    execSync('git add vbrief/', { cwd: TEST_DIR });
    execSync('git -c commit.gpgsign=false commit -q -m "seed with continue"', { cwd: TEST_DIR });

    const result = await transitionVBriefOnMain(
      TEST_DIR,
      'PAN-1',
      'active',
      'approved',
      'scope: approve PAN-1 vBRIEF',
    );

    // Continue file stays at canonical path; lifecycle dir transition has no effect on it
    expect(existsSync(getContinueFilePath(TEST_DIR, 'pan-1'))).toBe(true);
    expect(result.moved).toBe(true);
    expect(result.statusUpdated).toBe(true);
    expect(result.committed).toBe(true);
  });

  it('throws when no vBRIEF exists for the issue', async () => {
    initGitRepo(TEST_DIR);
    ensureVBriefDirs(TEST_DIR);
    await expect(
      transitionVBriefOnMain(TEST_DIR, 'PAN-999', 'active', 'approved', 'scope: approve PAN-999 vBRIEF'),
    ).rejects.toThrow();
  });

  it('does NOT commit when projectRoot is not on main', async () => {
    initGitRepo(TEST_DIR);
    ensureVBriefDirs(TEST_DIR);
    const filename = generateVBriefFilename('PAN-1', 'foo', '2026-05-03');
    writePlan(
      resolveVBriefDir(TEST_DIR, 'proposed'),
      filename,
      makePlan('PAN-1', 'foo', 'proposed'),
    );
    execSync('git add vbrief/', { cwd: TEST_DIR });
    execSync('git -c commit.gpgsign=false commit -q -m "seed proposed"', { cwd: TEST_DIR });
    execSync('git checkout -q -b feature/test', { cwd: TEST_DIR });

    const result = await transitionVBriefOnMain(
      TEST_DIR,
      'PAN-1',
      'active',
      'approved',
      'scope: approve PAN-1 vBRIEF',
    );

    // The on-disk move + status update happens regardless of branch.
    expect(result.moved).toBe(true);
    expect(result.statusUpdated).toBe(true);
    // But no commit since we're not on main.
    expect(result.committed).toBe(false);
    expect(existsSync(result.toPath)).toBe(true);

    // git log should still show only the init + seed commits, no scope commit.
    const logCount = execSync('git rev-list --count HEAD', { cwd: TEST_DIR, encoding: 'utf-8' }).trim();
    expect(logCount).toBe('2');
  });
});
