import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetDatabase, closeDatabase, getDatabase } from '../../../database/index.js';
import { tick } from '../loop.js';

const ORIGINAL_GITHUB_REPOS = process.env.GITHUB_REPOS;

describe('multi-developer pull-sync (PAN-805)', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pan-reconciler-'));
    process.env.PANOPTICON_HOME = tempHome;
    process.env.GITHUB_REPOS = 'PAN:eltmon/panopticon-cli';
    resetDatabase();

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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

  it('detects remote-ahead state and updates local canonical_state', async () => {
    const db = getDatabase();

    // Seed local issue_state as in_progress
    const oldTime = new Date(Date.now() - 60000).toISOString();
    db.prepare(
      `INSERT INTO issue_state (issue_id, canonical_state, last_synced_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run('PAN-999', 'in_progress', oldTime, oldTime);

    // Mock GitHub: listIssues open returns in-review label; closed returns empty
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const url = String(_url);
      if (url.includes('/issues?state=open') && init?.method === 'GET') {
        return new Response(
          JSON.stringify([
            { number: 999, state: 'open', labels: [{ name: 'in-review' }] },
          ]),
          { status: 200 }
        );
      }
      if (url.includes('/issues?state=closed') && init?.method === 'GET') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    // Drive one reconciler tick
    const config = { repo: 'eltmon/panopticon-cli', githubToken: 'fake-token', intervalMs: 30000 };
    const state = { running: false, timer: null, mutex: false };

    await tick(config, state);

    // Assert local canonical_state updated to in_review
    const row = db
      .prepare('SELECT canonical_state, last_synced_at FROM issue_state WHERE issue_id = ?')
      .get('PAN-999') as { canonical_state: string; last_synced_at: string };
    expect(row.canonical_state).toBe('in_review');
    expect(row.last_synced_at).not.toBe(oldTime);

    // Assert audit row
    const audits = db
      .prepare('SELECT * FROM label_sync_audit WHERE issue_id = ?')
      .all('PAN-999') as Array<{ outcome: string; reason: string | null }>;

    expect(audits.length).toBeGreaterThanOrEqual(1);
    const audit = audits[0];
    expect(audit.outcome).toBe('skipped');
    expect(audit.reason).toBe('remote_ahead_pulled');
  });
});
