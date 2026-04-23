import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetDatabase, closeDatabase, getDatabase } from '../../../database/index.js';
import { setCanonicalState } from '../index.js';
import { runPushStep } from '../push.js';
import { createGitHubClient } from '../github-client.js';

const ORIGINAL_GITHUB_REPOS = process.env.GITHUB_REPOS;

describe('rate-limit recovery (PAN-805)', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pan-reconciler-'));
    process.env.PANOPTICON_HOME = tempHome;
    process.env.GITHUB_REPOS = 'PAN:eltmon/panopticon-cli';
    resetDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    closeDatabase();
    rmSync(tempHome, { recursive: true, force: true });
    if (ORIGINAL_GITHUB_REPOS !== undefined) {
      process.env.GITHUB_REPOS = ORIGINAL_GITHUB_REPOS;
    } else {
      delete process.env.GITHUB_REPOS;
    }
    delete process.env.PANOPTICON_HOME;
  });

  it('429 Retry-After: 2 for first 3 attempts then 200 — eventually succeeds with audit trail', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const url = String(_url);
      // listIssueLabels always succeeds so push step can compute deltas
      if (url.endsWith('/labels') && init?.method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      // addLabel gets rate-limited for first 3 attempts
      callCount++;
      if (callCount <= 3) {
        return new Response(JSON.stringify({ message: 'Rate limited' }), {
          status: 429,
          headers: { 'retry-after': '2' },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    // Seed an issue with pending mutation (ensure last_synced_at is older than updated_at)
    const db = getDatabase();
    const oldTime = new Date(Date.now() - 60000).toISOString();
    db.prepare(
      `INSERT INTO issue_state (issue_id, canonical_state, last_synced_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run('PAN-456', 'in_progress', oldTime, new Date().toISOString());

    // Drive push step
    const gh = createGitHubClient({
      repo: 'eltmon/panopticon-cli',
      githubToken: 'fake-token',
      intervalMs: 30000,
    });

    await runPushStep(
      { repo: 'eltmon/panopticon-cli', githubToken: 'fake-token', intervalMs: 30000 },
      gh,
    );

    // Assert fetch was called 4 times (addLabel: 3 failures + 1 success)
    expect(callCount).toBe(4);

    // Assert audit trail
    const audits = db
      .prepare('SELECT * FROM label_sync_audit WHERE issue_id = ? ORDER BY attempted_at')
      .all('PAN-456') as Array<{
        target_label: string;
        action: string;
        outcome: string;
        retry_count: number;
        http_status: number | null;
      }>;

    expect(audits.length).toBeGreaterThanOrEqual(1);
    const lastAudit = audits[audits.length - 1];
    expect(lastAudit.outcome).toBe('success');
    expect(lastAudit.retry_count).toBeGreaterThanOrEqual(3);
    expect(lastAudit.http_status).toBe(200);
  }, 15000);

  it('429 Retry-After: HTTP-date form — computes delta correctly', async () => {
    const futureDate = new Date(Date.now() + 2000).toUTCString();
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const url = String(_url);
      if (url.endsWith('/labels') && init?.method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      callCount++;
      if (callCount <= 1) {
        return new Response(JSON.stringify({ message: 'Rate limited' }), {
          status: 429,
          headers: { 'retry-after': futureDate },
        });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const db = getDatabase();
    const oldTime = new Date(Date.now() - 60000).toISOString();
    db.prepare(
      `INSERT INTO issue_state (issue_id, canonical_state, last_synced_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run('PAN-457', 'in_progress', oldTime, new Date().toISOString());

    const gh = createGitHubClient({
      repo: 'eltmon/panopticon-cli',
      githubToken: 'fake-token',
      intervalMs: 30000,
    });

    await runPushStep(
      { repo: 'eltmon/panopticon-cli', githubToken: 'fake-token', intervalMs: 30000 },
      gh,
    );

    expect(callCount).toBe(2);

    const audits = db
      .prepare('SELECT * FROM label_sync_audit WHERE issue_id = ? ORDER BY attempted_at')
      .all('PAN-457') as Array<{ outcome: string; retry_count: number }>;

    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[audits.length - 1].outcome).toBe('success');
  }, 15000);
});
