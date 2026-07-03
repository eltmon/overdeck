import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { checkPrdGateSync, MIN_PRD_LINES, getDraftsDir } from '../drafts.js';
import { getProjectPanPaths } from '../specs.js';

let projectRoot: string;
let workspaceRoot: string;

function twentyLineDraft(): string {
  return Array.from({ length: MIN_PRD_LINES }, (_, i) => `line ${i + 1}`).join('\n');
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'prd-gate-project-'));
  workspaceRoot = mkdtempSync(join(tmpdir(), 'prd-gate-ws-'));
});

afterEach(() => {
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  if (existsSync(workspaceRoot)) rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('checkPrdGateSync', () => {
  it('passes when an uppercase projectRoot draft has >= MIN_PRD_LINES lines', () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const upper = join(draftsDir, 'PAN-2234.md');
    writeFileSync(upper, twentyLineDraft(), 'utf-8');

    const result = checkPrdGateSync({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2234' });

    expect(result).toEqual({ ok: true, path: upper, lineCount: MIN_PRD_LINES });
  });

  it('falls back to a lowercase projectRoot draft when no uppercase file exists', () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const lower = join(draftsDir, 'pan-2234.md');
    writeFileSync(lower, twentyLineDraft(), 'utf-8');

    const result = checkPrdGateSync({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2234' });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(lower);
    expect(result.lineCount).toBe(MIN_PRD_LINES);
  });

  it('finds a workspace draft when projectRoot is null (workspace-only search)', () => {
    const wsDrafts = join(workspaceRoot, '.pan', 'drafts');
    mkdirSync(wsDrafts, { recursive: true });
    const upper = join(wsDrafts, 'PAN-2234.md');
    writeFileSync(upper, twentyLineDraft(), 'utf-8');

    const result = checkPrdGateSync({ projectRoot: null, workspacePath: workspaceRoot, issueId: 'PAN-2234' });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(upper);
  });

  it('reports missing with every candidate in searched when nothing exists', () => {
    const result = checkPrdGateSync({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2234' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing');
    // Four candidates: projectRoot (upper + lower), workspace (upper + lower).
    expect(result.searched).toHaveLength(4);
    expect(result.searched).toEqual([
      join(getDraftsDir(projectRoot), 'PAN-2234.md'),
      join(getDraftsDir(projectRoot), 'pan-2234.md'),
      join(workspaceRoot, '.pan', 'drafts', 'PAN-2234.md'),
      join(workspaceRoot, '.pan', 'drafts', 'pan-2234.md'),
    ]);
  });

  it('reports too-short naming the found path and line count for a thin draft', () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const upper = join(draftsDir, 'PAN-2234.md');
    const thin = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join('\n');
    writeFileSync(upper, thin, 'utf-8');

    const result = checkPrdGateSync({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2234' });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('too-short');
    expect(result.path).toBe(upper);
    expect(result.lineCount).toBe(5);
  });

  it('passes at exactly the MIN_PRD_LINES boundary', () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const upper = join(draftsDir, 'PAN-2234.md');
    // Exactly MIN_PRD_LINES lines (no trailing newline → split yields MIN lines).
    writeFileSync(upper, twentyLineDraft(), 'utf-8');

    const result = checkPrdGateSync({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2234' });

    expect(result.ok).toBe(true);
    expect(result.lineCount).toBe(MIN_PRD_LINES);
  });

  it('prefers the projectRoot uppercase candidate over workspace candidates', () => {
    const projectDrafts = getDraftsDir(projectRoot);
    mkdirSync(projectDrafts, { recursive: true });
    const projectUpper = join(projectDrafts, 'PAN-2234.md');
    writeFileSync(projectUpper, twentyLineDraft(), 'utf-8');

    const wsDrafts = join(workspaceRoot, '.pan', 'drafts');
    mkdirSync(wsDrafts, { recursive: true });
    writeFileSync(join(wsDrafts, 'PAN-2234.md'), twentyLineDraft(), 'utf-8');

    const result = checkPrdGateSync({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2234' });

    expect(result.ok).toBe(true);
    expect(result.path).toBe(projectUpper);
  });

  it('uses getProjectPanPaths draftsDir (honors a non-default pan dir layout)', () => {
    // getDraftsDir routes through getProjectPanPaths; confirm the gate's project
    // candidate path matches it so a custom panDir layout still resolves.
    const expected = join(getProjectPanPaths(projectRoot).draftsDir, 'PAN-2234.md');
    expect(join(getDraftsDir(projectRoot), 'PAN-2234.md')).toBe(expected);
  });
});
