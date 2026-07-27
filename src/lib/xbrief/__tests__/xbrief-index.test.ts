/**
 * PAN-3165 regression: the async xBRIEF index and the sync lifecycle resolver
 * must agree on where specs live. The index hardcoded `<projectRoot>/.pan/specs`
 * — the pre-PAN-2541 in-repo location — so every spec written to the
 * `overdeck-state` worktree since the cutover resolved to null, and the UAT
 * panel rendered that miss as the confident sentence "No UAT steps in plan".
 */
import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';

import { findXBriefByIssue, resetXBriefIndex } from '../xbrief-index.js';
import { findXBriefByIssueSync } from '../lifecycle-io.js';
import { generateXBriefFilename } from '../lifecycle.js';
import { PAN_DIRNAME, PAN_SPECS_DIRNAME } from '../../pan-dir/types.js';
import type { XBriefDocument } from '../types.js';

let projectRoot: string;
let overdeckHome: string;
let previousOverdeckHome: string | undefined;

function makeSpec(issueId: string): unknown {
  const doc: XBriefDocument = {
    xBRIEFInfo: { version: '0.5', created: '2026-07-26T00:00:00Z' },
    plan: {
      id: issueId.toLowerCase(),
      title: `Plan for ${issueId}`,
      status: 'proposed',
      sequence: 1,
      created: '2026-07-26T00:00:00Z',
      items: [],
      edges: [],
    },
  };
  return { ...doc, status: 'proposed' };
}

function writeSpecFile(specsDir: string, issueId: string): string {
  mkdirSync(specsDir, { recursive: true });
  const path = join(specsDir, generateXBriefFilename(issueId, 'fix-the-thing', '2026-07-26'));
  writeFileSync(path, JSON.stringify(makeSpec(issueId), undefined, 2), 'utf-8');
  return path;
}

/** Mark the project migrated so the state read door resolves the state worktree. */
function markMigrated(stateRoot: string): void {
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(
    join(stateRoot, 'migration-complete.json'),
    JSON.stringify({
      version: 1,
      sourceMainSha: 'a'.repeat(40),
      stateBranchSha: 'b'.repeat(40),
      completedAt: '2026-07-26T00:00:00Z',
    }),
    'utf-8',
  );
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'xbrief-index-project-'));
  overdeckHome = mkdtempSync(join(tmpdir(), 'xbrief-index-home-'));
  previousOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = overdeckHome;
  resetXBriefIndex();
});

afterEach(() => {
  if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousOverdeckHome;
  resetXBriefIndex();
  for (const dir of [projectRoot, overdeckHome]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe('findXBriefByIssue (async index) vs findXBriefByIssueSync', () => {
  it('resolves a state-branch spec to the same path as the sync resolver', async () => {
    const stateRoot = join(overdeckHome, 'state', basename(projectRoot));
    markMigrated(stateRoot);
    const specPath = writeSpecFile(join(stateRoot, PAN_SPECS_DIRNAME), 'PAN-3158');

    const asyncFound = await Effect.runPromise(findXBriefByIssue(projectRoot, 'PAN-3158'));
    const syncFound = findXBriefByIssueSync(projectRoot, 'PAN-3158');

    expect(asyncFound?.path).toBe(specPath);
    expect(syncFound?.path).toBe(specPath);
    expect(asyncFound?.path).toBe(syncFound?.path);
  });

  it('finds a state-branch spec even when the legacy <root>/.pan/specs directory exists', async () => {
    const stateRoot = join(overdeckHome, 'state', basename(projectRoot));
    markMigrated(stateRoot);
    const specPath = writeSpecFile(join(stateRoot, PAN_SPECS_DIRNAME), 'PAN-3158');
    // A stale pre-cutover directory holding an unrelated spec must not shadow it.
    writeSpecFile(join(projectRoot, PAN_DIRNAME, PAN_SPECS_DIRNAME), 'PAN-2000');

    const asyncFound = await Effect.runPromise(findXBriefByIssue(projectRoot, 'PAN-3158'));

    expect(asyncFound?.path).toBe(specPath);
    expect(await Effect.runPromise(findXBriefByIssue(projectRoot, 'PAN-2000'))).toBeNull();
  });

  it('agrees with the sync resolver for an unmigrated project', async () => {
    const specPath = writeSpecFile(join(projectRoot, PAN_DIRNAME, PAN_SPECS_DIRNAME), 'PAN-3158');

    const asyncFound = await Effect.runPromise(findXBriefByIssue(projectRoot, 'PAN-3158'));
    const syncFound = findXBriefByIssueSync(projectRoot, 'PAN-3158');

    expect(asyncFound?.path).toBe(specPath);
    expect(syncFound?.path).toBe(specPath);
  });

  it('agrees with the sync resolver when no spec exists', async () => {
    expect(await Effect.runPromise(findXBriefByIssue(projectRoot, 'PAN-9999'))).toBeNull();
    expect(findXBriefByIssueSync(projectRoot, 'PAN-9999')).toBeNull();
  });
});
