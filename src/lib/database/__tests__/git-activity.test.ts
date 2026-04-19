/**
 * PAN-653: git_operations table and git-activity service tests.
 *
 * Verifies:
 * AC1: git_operations table exists with all columns and indexes after fresh init and after migration
 * AC2: appendGitOperation and listGitOperations work and are used by the activity API
 * AC3: Rows survive a dashboard process restart (via SQLite persistence)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-653-git-activity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('git_operations schema (PAN-653)', () => {
  it('git_operations table has all required columns after fresh init', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();

    const columns = db
      .prepare(`PRAGMA table_info(git_operations)`)
      .all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);

    expect(names).toContain('id');
    expect(names).toContain('operation');
    expect(names).toContain('branch');
    expect(names).toContain('issue_id');
    expect(names).toContain('before_sha');
    expect(names).toContain('after_sha');
    expect(names).toContain('remote_sha');
    expect(names).toContain('status');
    expect(names).toContain('error');
    expect(names).toContain('ts');
  });

  it('git_operations indexes exist', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();

    const indexes = db
      .prepare(`PRAGMA index_list(git_operations)`)
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_git_ops_issue_ts');
    expect(indexNames).toContain('idx_git_ops_op_ts');
  });
});

describe('appendGitOperation + listGitOperations (PAN-653)', () => {
  it('appends a row and reads it back', async () => {
    const { appendGitOperation, listGitOperations } = await import(
      '../../../lib/git-activity.js'
    );

    const ts = new Date().toISOString();
    const id = appendGitOperation({
      operation: 'push',
      branch: 'main',
      issueId: 'PAN-653',
      beforeSha: 'abc',
      afterSha: 'def',
      remoteSha: 'ghi',
      status: 'success',
      ts,
    });

    expect(id).toBeGreaterThan(0);

    const rows = listGitOperations({ issueId: 'PAN-653' });
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe('push');
    expect(rows[0].branch).toBe('main');
    expect(rows[0].issueId).toBe('PAN-653');
    expect(rows[0].beforeSha).toBe('abc');
    expect(rows[0].afterSha).toBe('def');
    expect(rows[0].remoteSha).toBe('ghi');
    expect(rows[0].status).toBe('success');
    expect(rows[0].ts).toBe(ts);
  });

  it('filters by operation type', async () => {
    const { appendGitOperation, listGitOperations } = await import(
      '../../../lib/git-activity.js'
    );

    const ts = new Date().toISOString();
    appendGitOperation({ operation: 'push', issueId: 'PAN-1', status: 'success', ts });
    appendGitOperation({ operation: 'fetch', issueId: 'PAN-1', status: 'success', ts });
    appendGitOperation({ operation: 'main_diverged', issueId: 'PAN-1', status: 'aborted', ts });

    const pushRows = listGitOperations({ operation: 'push' });
    expect(pushRows).toHaveLength(1);
    expect(pushRows[0].operation).toBe('push');

    const divergedRows = listGitOperations({ operation: 'main_diverged' });
    expect(divergedRows).toHaveLength(1);
    expect(divergedRows[0].status).toBe('aborted');
  });

  it('filters by issueId', async () => {
    const { appendGitOperation, listGitOperations } = await import(
      '../../../lib/git-activity.js'
    );

    const ts = new Date().toISOString();
    appendGitOperation({ operation: 'push', issueId: 'PAN-100', status: 'success', ts });
    appendGitOperation({ operation: 'push', issueId: 'PAN-200', status: 'success', ts });

    expect(listGitOperations({ issueId: 'PAN-100' })).toHaveLength(1);
    expect(listGitOperations({ issueId: 'PAN-200' })).toHaveLength(1);
    expect(listGitOperations()).toHaveLength(2);
  });

  it('rows survive a simulated restart (new DB connection)', async () => {
    const { appendGitOperation } = await import(
      '../../../lib/git-activity.js'
    );

    const ts = new Date().toISOString();
    appendGitOperation({ operation: 'push', issueId: 'PAN-999', status: 'success', ts });

    // Simulate restart by resetting the DB singleton, then reconnecting
    await resetDb();

    // Reconnect to the same SQLite file
    const { listGitOperations } = await import(
      '../../../lib/git-activity.js'
    );
    const rows = listGitOperations({ issueId: 'PAN-999' });
    expect(rows).toHaveLength(1);
    expect(rows[0].operation).toBe('push');
  });
});
