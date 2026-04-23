import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetDatabase, closeDatabase } from '../../../database/index.js';
import { setCanonicalState } from '../index.js';
import { transitionIssueToInProgress } from '../../../agents.js';

const ORIGINAL_GITHUB_REPOS = process.env.GITHUB_REPOS;

describe('respawn flood idempotency (PAN-805)', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pan-reconciler-'));
    process.env.PANOPTICON_HOME = tempHome;
    process.env.GITHUB_REPOS = 'PAN:eltmon/panopticon-cli';
    resetDatabase();

    // Mock global fetch so any accidental API call is caught
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    // Suppress idempotency logs during the 1000 iterations
    vi.spyOn(console, 'log').mockImplementation(() => {});
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

  it('1000x transitionIssueToInProgress yields 0 API calls when already in_progress', async () => {
    // Seed the issue as already in_progress
    setCanonicalState('PAN-123', 'in_progress');

    // Call transitionIssueToInProgress 1000 times
    for (let i = 0; i < 1000; i++) {
      await transitionIssueToInProgress('PAN-123');
    }

    // Verify no fetch calls were made
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
