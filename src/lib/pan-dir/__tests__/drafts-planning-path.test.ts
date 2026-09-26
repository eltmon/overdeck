import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { getDraftsDir, resolvePlanningDraftPath } from '../drafts.js';

let workspacePath: string;
let primaryRoot: string;

beforeEach(() => {
  workspacePath = mkdtempSync(join(tmpdir(), 'draft-path-ws-'));
  primaryRoot = mkdtempSync(join(tmpdir(), 'draft-path-primary-'));
});

afterEach(() => {
  rmSync(workspacePath, { recursive: true, force: true });
  rmSync(primaryRoot, { recursive: true, force: true });
});

/**
 * PAN-4224 WI-5: a planning prompt or PRD-gate message must point at the
 * draft the running agent will actually read — the workspace's own copy,
 * since promotion now targets the workspace, not the primary checkout.
 */
describe('resolvePlanningDraftPath', () => {
  it('returns the workspace path when both the workspace and primary hold a draft', () => {
    const wsDraftsDir = getDraftsDir(workspacePath);
    mkdirSync(wsDraftsDir, { recursive: true });
    const wsDraft = join(wsDraftsDir, 'pan-9.md');
    writeFileSync(wsDraft, 'workspace draft\n', 'utf-8');

    const primaryDraftsDir = getDraftsDir(primaryRoot);
    mkdirSync(primaryDraftsDir, { recursive: true });
    writeFileSync(join(primaryDraftsDir, 'pan-9.md'), 'primary draft\n', 'utf-8');

    expect(resolvePlanningDraftPath(workspacePath, primaryRoot, 'PAN-9')).toBe(wsDraft);
  });

  it('returns the primary path when only the primary holds a draft', () => {
    const primaryDraftsDir = getDraftsDir(primaryRoot);
    mkdirSync(primaryDraftsDir, { recursive: true });
    const primaryDraft = join(primaryDraftsDir, 'pan-9.md');
    writeFileSync(primaryDraft, 'primary draft\n', 'utf-8');

    expect(resolvePlanningDraftPath(workspacePath, primaryRoot, 'PAN-9')).toBe(primaryDraft);
  });

  it('returns null when neither the workspace nor the primary holds a draft', () => {
    expect(resolvePlanningDraftPath(workspacePath, primaryRoot, 'PAN-9')).toBeNull();
  });

  it('returns null when there is no primary root and the workspace has no draft', () => {
    expect(resolvePlanningDraftPath(workspacePath, null, 'PAN-9')).toBeNull();
  });
});
