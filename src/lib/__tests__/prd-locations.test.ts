import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { findDraftPrd, findDraftPrdSync, findPrdAnywhere } from '../prd-locations.js';
import { getDraftsDir } from '../pan-dir/index.js';

let projectRoot: string;
let workspacePath: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'prd-locations-'));
  workspacePath = mkdtempSync(join(tmpdir(), 'prd-locations-ws-'));
});

afterEach(() => {
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  if (existsSync(workspacePath)) rmSync(workspacePath, { recursive: true, force: true });
});

describe('findDraftPrdSync', () => {
  it('finds an uppercase canonical draft', () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const upper = join(draftsDir, 'PAN-2858.md');
    writeFileSync(upper, 'prd\n', 'utf-8');

    expect(findDraftPrdSync(projectRoot, 'PAN-2858')).toEqual({
      path: upper,
      format: 'pan-draft',
      status: 'draft',
    });
  });

  it('finds a lowercase canonical draft (historical filename case)', () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const lower = join(draftsDir, 'pan-2858.md');
    writeFileSync(lower, 'prd\n', 'utf-8');

    expect(findDraftPrdSync(projectRoot, 'PAN-2858')?.path).toBe(lower);
  });

  it('returns null when no draft exists', () => {
    expect(findDraftPrdSync(projectRoot, 'PAN-2858')).toBeNull();
  });

  /**
   * PAN-4224: complete-planning now promotes the PRD draft onto the issue's
   * workspace plan home, not the primary checkout, so a reader given a
   * workspacePath must prefer its draft over a stale or absent primary copy.
   */
  it('prefers the workspace draft over the primary checkout when both exist', () => {
    const primaryDraftsDir = getDraftsDir(projectRoot);
    mkdirSync(primaryDraftsDir, { recursive: true });
    writeFileSync(join(primaryDraftsDir, 'pan-2858.md'), 'primary\n', 'utf-8');

    const wsDraftsDir = getDraftsDir(workspacePath);
    mkdirSync(wsDraftsDir, { recursive: true });
    const wsDraft = join(wsDraftsDir, 'pan-2858.md');
    writeFileSync(wsDraft, 'workspace\n', 'utf-8');

    expect(findDraftPrdSync(projectRoot, 'PAN-2858', workspacePath)?.path).toBe(wsDraft);
  });

  it('falls back to the primary checkout when only it holds a draft', () => {
    const primaryDraftsDir = getDraftsDir(projectRoot);
    mkdirSync(primaryDraftsDir, { recursive: true });
    const primaryDraft = join(primaryDraftsDir, 'pan-2858.md');
    writeFileSync(primaryDraft, 'primary\n', 'utf-8');

    expect(findDraftPrdSync(projectRoot, 'PAN-2858', workspacePath)?.path).toBe(primaryDraft);
  });
});

describe('findDraftPrd', () => {
  it('finds a draft through the async filesystem effect', async () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const lower = join(draftsDir, 'pan-2858.md');
    writeFileSync(lower, 'prd\n', 'utf-8');

    await expect(findDraftPrd(projectRoot, 'PAN-2858')).resolves.toEqual({
      path: lower,
      format: 'pan-draft',
      status: 'draft',
    });
  });

  it('returns null asynchronously when no draft exists', async () => {
    await expect(findDraftPrd(projectRoot, 'PAN-2858')).resolves.toBeNull();
  });

  it('prefers the workspace draft over the primary checkout when both exist', async () => {
    const primaryDraftsDir = getDraftsDir(projectRoot);
    mkdirSync(primaryDraftsDir, { recursive: true });
    writeFileSync(join(primaryDraftsDir, 'pan-2858.md'), 'primary\n', 'utf-8');

    const wsDraftsDir = getDraftsDir(workspacePath);
    mkdirSync(wsDraftsDir, { recursive: true });
    const wsDraft = join(wsDraftsDir, 'pan-2858.md');
    writeFileSync(wsDraft, 'workspace\n', 'utf-8');

    const location = await findDraftPrd(projectRoot, 'PAN-2858', workspacePath);
    expect(location?.path).toBe(wsDraft);
  });
});

describe('findPrdAnywhere', () => {
  it('falls through to the canonical draft when no legacy status PRD exists', () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const lower = join(draftsDir, 'pan-2858.md');
    writeFileSync(lower, 'prd\n', 'utf-8');

    const loc = findPrdAnywhere(projectRoot, 'PAN-2858');
    expect(loc?.format).toBe('pan-draft');
    expect(loc?.path).toBe(lower);
  });

  it('prefers the workspace draft over the primary checkout within the draft tier', () => {
    const primaryDraftsDir = getDraftsDir(projectRoot);
    mkdirSync(primaryDraftsDir, { recursive: true });
    writeFileSync(join(primaryDraftsDir, 'pan-2858.md'), 'primary\n', 'utf-8');

    const wsDraftsDir = getDraftsDir(workspacePath);
    mkdirSync(wsDraftsDir, { recursive: true });
    const wsDraft = join(wsDraftsDir, 'pan-2858.md');
    writeFileSync(wsDraft, 'workspace\n', 'utf-8');

    const loc = findPrdAnywhere(projectRoot, 'PAN-2858', workspacePath);
    expect(loc?.path).toBe(wsDraft);
  });
});
