/**
 * Integration tests for the canonical issue-record enumeration against a REAL
 * temporary filesystem — no mocks of the door itself.
 *
 * Why this file exists (PAN-3841, review cycle 5): the retrospective evidence
 * tests inject `listRecords`, so they could never observe how the production
 * resolver behaves on an unreadable directory, a corrupt record, or the legacy
 * per-workspace layout. A green mock-only suite sat on top of a door that
 * silently returned `[]` when it could not read anything — which a retrospective
 * would then report as "nothing happened".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listIssueRecords,
  listIssueRecordsDetailed,
  RECORD_ENUMERATION_CONCURRENCY,
} from '../record-list.js';
import type { ProjectConfig } from '../../projects.js';

let root: string;
let prevHome: string | undefined;

async function writeRecord(dir: string, issueId: string, extra: Record<string, unknown> = {}) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${issueId.toLowerCase()}.json`),
    JSON.stringify({ issueId, schemaVersion: 2, updated: '2026-09-16T12:00:00.000Z', ...extra }),
    'utf-8',
  );
}

/** A valid migration marker, matching validMarker() in state-read-home.ts. */
async function markMigrated(stateRoot: string) {
  await mkdir(stateRoot, { recursive: true });
  await writeFile(
    join(stateRoot, 'migration-complete.json'),
    JSON.stringify({
      sourceMainSha: 'a'.repeat(40),
      stateBranchSha: 'b'.repeat(40),
      completedAt: '2026-09-16T00:00:00.000Z',
      version: 1,
    }),
    'utf-8',
  );
}

/** State root for an unregistered temp project: projectKey falls back to basename. */
function stateRootFor(repoPath: string): string {
  return join(process.env.OVERDECK_HOME as string, 'state', repoPath.split('/').pop() as string);
}

/** A project whose state home resolves to the legacy layout (no migration marker). */
function legacyProject(repoPath: string): ProjectConfig {
  return { path: repoPath } as unknown as ProjectConfig;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pan3841-recordlist-'));
  prevHome = process.env.OVERDECK_HOME;
  // Point the state home at an empty dir so no migration marker is found and
  // the resolver takes the legacy branch deterministically.
  process.env.OVERDECK_HOME = join(root, 'overdeck-home');
  await mkdir(process.env.OVERDECK_HOME, { recursive: true });
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevHome;
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('listIssueRecords against a real filesystem (legacy layout)', () => {
  it('reads project-level records AND every per-issue workspace records dir', async () => {
    // This is the shape a project state-root concatenation gets wrong: the
    // legacy layout is issue-workspace scoped, so records live under each
    // workspace as well as at the project root.
    const repo = join(root, 'repo');
    await writeRecord(join(repo, '.pan', 'records'), 'PAN-1');
    await writeRecord(join(repo, 'workspaces', 'feature-pan-2', '.pan', 'records'), 'PAN-2');
    await writeRecord(join(repo, 'workspaces', 'feature-pan-3', '.pan', 'records'), 'PAN-3');

    const { records, failures } = await listIssueRecordsDetailed(legacyProject(repo));
    expect(records.map((r) => r.issueId).sort()).toEqual(['PAN-1', 'PAN-2', 'PAN-3']);
    expect(failures).toEqual([]);
  });

  it('returns an empty list with NO failures when the records dir simply does not exist', async () => {
    // Absent is a normal shape (a project with no records yet) and must not be
    // reported as an inability to read — otherwise every young project renders
    // a scary EVIDENCE UNAVAILABLE block.
    const repo = join(root, 'empty-repo');
    await mkdir(repo, { recursive: true });
    const { records, failures } = await listIssueRecordsDetailed(legacyProject(repo));
    expect(records).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('surfaces a corrupt record as a failure instead of silently dropping it', async () => {
    const repo = join(root, 'corrupt-repo');
    const dir = join(repo, '.pan', 'records');
    await writeRecord(dir, 'PAN-10');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'pan-11.json'), '{ this is not json', 'utf-8');

    const { records, failures } = await listIssueRecordsDetailed(legacyProject(repo));
    // The readable record still comes back — one bad file must not void the batch.
    expect(records.map((r) => r.issueId)).toEqual(['PAN-10']);
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe('record');
    expect(failures[0].path).toContain('pan-11.json');
  });

  it('surfaces an unreadable records directory as a readdir failure', async () => {
    const repo = join(root, 'locked-repo');
    const dir = join(repo, '.pan', 'records');
    await writeRecord(dir, 'PAN-20');
    await chmod(dir, 0o000);
    try {
      const { records, failures } = await listIssueRecordsDetailed(legacyProject(repo));
      // Running as root defeats chmod; only assert when the mode actually bit.
      if (records.length === 0) {
        expect(failures.some((f) => f.kind === 'readdir' && f.path === dir)).toBe(true);
      }
    } finally {
      await chmod(dir, 0o755).catch(() => {});
    }
  });

  it('reads a large directory correctly under the concurrency bound', async () => {
    const repo = join(root, 'big-repo');
    const dir = join(repo, '.pan', 'records');
    const count = RECORD_ENUMERATION_CONCURRENCY * 5 + 3;
    for (let i = 0; i < count; i++) await writeRecord(dir, `PAN-${100 + i}`);
    const records = await listIssueRecords(legacyProject(repo));
    expect(records).toHaveLength(count);
  });

  it('ignores non-JSON files and keeps the array-only facet behaviourally identical', async () => {
    const repo = join(root, 'mixed-repo');
    const dir = join(repo, '.pan', 'records');
    await writeRecord(dir, 'PAN-30');
    await writeFile(join(dir, 'README.md'), 'not a record', 'utf-8');
    const viaArray = await listIssueRecords(legacyProject(repo));
    const viaDetailed = await listIssueRecordsDetailed(legacyProject(repo));
    expect(viaArray.map((r) => r.issueId)).toEqual(['PAN-30']);
    expect(viaDetailed.records.map((r) => r.issueId)).toEqual(['PAN-30']);
  });
});


describe('listIssueRecords against a real filesystem (migrated layout)', () => {
  it('reads records from the migrated state root, not the legacy paths', async () => {
    // Requirement #5 explicitly covers BOTH layouts. A legacy-only fixture
    // cannot catch a resolver that picks the wrong branch, which is the exact
    // mistake an earlier cycle shipped.
    const repo = join(root, 'migrated-repo');
    const stateRoot = stateRootFor(repo);
    await markMigrated(stateRoot);
    await writeRecord(join(stateRoot, 'records'), 'PAN-200');
    // Decoys: a migrated project must NOT pick these up.
    await writeRecord(join(repo, '.pan', 'records'), 'PAN-LEGACY');
    await writeRecord(join(repo, 'workspaces', 'feature-x', '.pan', 'records'), 'PAN-WORKSPACE');

    const { records, failures } = await listIssueRecordsDetailed(legacyProject(repo));
    expect(records.map((r) => r.issueId)).toEqual(['PAN-200']);
    expect(records.map((r) => r.issueId)).not.toContain('PAN-LEGACY');
    expect(records.map((r) => r.issueId)).not.toContain('PAN-WORKSPACE');
    expect(failures).toEqual([]);
  });

  it('surfaces a corrupt record in the migrated layout', async () => {
    const repo = join(root, 'migrated-corrupt');
    const stateRoot = stateRootFor(repo);
    await markMigrated(stateRoot);
    const dir = join(stateRoot, 'records');
    await writeRecord(dir, 'PAN-210');
    await writeFile(join(dir, 'pan-211.json'), 'not json at all', 'utf-8');

    const { records, failures } = await listIssueRecordsDetailed(legacyProject(repo));
    expect(records.map((r) => r.issueId)).toEqual(['PAN-210']);
    expect(failures).toHaveLength(1);
    expect(failures[0].kind).toBe('record');
  });

  it('reports an empty migrated records dir without inventing a failure', async () => {
    const repo = join(root, 'migrated-empty');
    await markMigrated(stateRootFor(repo));
    const { records, failures } = await listIssueRecordsDetailed(legacyProject(repo));
    expect(records).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('surfaces an unreadable migrated records dir as a readdir failure', async () => {
    const repo = join(root, 'migrated-locked');
    const stateRoot = stateRootFor(repo);
    await markMigrated(stateRoot);
    const dir = join(stateRoot, 'records');
    await writeRecord(dir, 'PAN-220');
    await chmod(dir, 0o000);
    try {
      const { records, failures } = await listIssueRecordsDetailed(legacyProject(repo));
      if (records.length === 0) {
        expect(failures.some((f) => f.kind === 'readdir' && f.path === dir)).toBe(true);
      }
    } finally {
      await chmod(dir, 0o755).catch(() => {});
    }
  });
});
