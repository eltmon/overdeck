import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';

import { findDraftPrd, findDraftPrdSync, findPrdAnywhereSync } from '../prd-locations.js';
import { getDraftsDir } from '../pan-dir/index.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'prd-locations-'));
});

afterEach(() => {
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
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
});

describe('findDraftPrd', () => {
  it('finds a draft through the async filesystem effect', async () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const lower = join(draftsDir, 'pan-2858.md');
    writeFileSync(lower, 'prd\n', 'utf-8');

    await expect(Effect.runPromise(findDraftPrd(projectRoot, 'PAN-2858'))).resolves.toEqual({
      path: lower,
      format: 'pan-draft',
      status: 'draft',
    });
  });

  it('returns null asynchronously when no draft exists', async () => {
    await expect(Effect.runPromise(findDraftPrd(projectRoot, 'PAN-2858'))).resolves.toBeNull();
  });
});

describe('findPrdAnywhereSync', () => {
  it('falls through to the canonical draft when no legacy status PRD exists', () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const lower = join(draftsDir, 'pan-2858.md');
    writeFileSync(lower, 'prd\n', 'utf-8');

    const loc = findPrdAnywhereSync(projectRoot, 'PAN-2858');
    expect(loc?.format).toBe('pan-draft');
    expect(loc?.path).toBe(lower);
  });
});
