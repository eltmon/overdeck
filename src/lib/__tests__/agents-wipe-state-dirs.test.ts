/**
 * Tests for the wipeAgentStateDirs helper (PAN-1985).
 *
 * The helper is the shared primitive that the work restart-fresh route and
 * the review restart extension both use to clean state before respawning.
 * Its job is narrow: rm -rf the matching agent dirs under
 * ~/.overdeck/agents/ for a given issue, leaving the work agent dir alone
 * (when rolePrefix is set) or vice versa. Workspace, vBRIEF, beads,
 * .pan/continue.json, the branch, and the commit history are all outside
 * the scope and must be left intact.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// We control AGENTS_DIR via vi.mock so the helper operates on a per-test
// tmpdir. Each beforeEach wipes + recreates the tmpdir. The mock returns
// a *getter* for AGENTS_DIR so it reads the env var at access time, not at
// module-evaluation time (vi.mock factories are evaluated once, before
// beforeAll runs).
let TEST_AGENTS_DIR: string;

vi.mock('../paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../paths.js')>();
  return {
    ...actual,
    get AGENTS_DIR() {
      return process.env.TEST_AGENTS_DIR ?? actual.AGENTS_DIR;
    },
  };
});

// Import AFTER the mock so the helper binds to the mocked AGENTS_DIR.
import { wipeAgentStateDirs } from '../agents.js';

beforeAll(() => {
  TEST_AGENTS_DIR = mkdtempSync(join(tmpdir(), 'agents-wipe-test-'));
  process.env.TEST_AGENTS_DIR = TEST_AGENTS_DIR;
});

afterAll(() => {
  if (TEST_AGENTS_DIR && existsSync(TEST_AGENTS_DIR)) {
    rmSync(TEST_AGENTS_DIR, { recursive: true, force: true });
  }
  delete process.env.TEST_AGENTS_DIR;
});

beforeEach(() => {
  rmSync(TEST_AGENTS_DIR, { recursive: true, force: true });
  mkdirSync(TEST_AGENTS_DIR, { recursive: true });
});

afterEach(() => {
  // ensure the next beforeEach starts clean even on failure
  if (existsSync(TEST_AGENTS_DIR)) {
    rmSync(TEST_AGENTS_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_AGENTS_DIR, { recursive: true });
});

function makeAgentDir(name: string, files: string[] = ['state.json', 'activity.jsonl', 'session.id']) {
  const dir = join(TEST_AGENTS_DIR, name);
  mkdirSync(dir, { recursive: true });
  for (const file of files) {
    writeFileSync(join(dir, file), `seed-content-for-${file}`);
  }
  return dir;
}

describe('wipeAgentStateDirs (PAN-1985) — work agent wipe', () => {
  it('wipes only the work agent dir when no rolePrefix is given', async () => {
    const workDir = makeAgentDir('agent-pan-1866');
    const reviewDir = makeAgentDir('agent-pan-1866-review');
    const reviewSecurityDir = makeAgentDir('agent-pan-1866-review-security');
    const otherWorkDir = makeAgentDir('agent-pan-1867');

    const result = await wipeAgentStateDirs('PAN-1866');

    expect(result.removed).toEqual(['agent-pan-1866']);
    expect(existsSync(workDir)).toBe(false);
    // Specialist dirs (review, sub-reviewers) MUST be left alone.
    expect(existsSync(reviewDir)).toBe(true);
    expect(existsSync(reviewSecurityDir)).toBe(true);
    // A different issue's work dir is untouched.
    expect(existsSync(otherWorkDir)).toBe(true);
  });

  it('returns removed=[] when no matching dirs exist', async () => {
    const otherDir = makeAgentDir('agent-pan-1867');

    const result = await wipeAgentStateDirs('PAN-1866');

    expect(result.removed).toEqual([]);
    expect(existsSync(otherDir)).toBe(true);
  });

  it('removes every tracked file inside the agent dir (state.json, session.id, activity.jsonl, etc.)', async () => {
    const workDir = makeAgentDir('agent-pan-1866', [
      'state.json',
      'session.id',
      'sessions.json',
      'codex-thread-id',
      'runtime.json',
      'activity.jsonl',
      'lifecycle.log',
      'cv.json',
      'health.json',
      'launcher.sh',
      'initial-prompt.md',
      'initial-context-pct',
      'ready.json',
    ]);
    const workMailDir = join(workDir, 'mail');
    mkdirSync(workMailDir, { recursive: true });
    writeFileSync(join(workMailDir, 'inbox.jsonl'), 'mail');

    await wipeAgentStateDirs('PAN-1866');

    expect(existsSync(workDir)).toBe(false);
  });
});

describe('wipeAgentStateDirs (PAN-1985) — review wipe (rolePrefix)', () => {
  it('wipes the review parent + all sub-reviewers when rolePrefix is set', async () => {
    const workDir = makeAgentDir('agent-pan-1866');
    const reviewDir = makeAgentDir('agent-pan-1866-review');
    const reviewSecurityDir = makeAgentDir('agent-pan-1866-review-security');
    const reviewCorrectnessDir = makeAgentDir('agent-pan-1866-review-correctness');
    const reviewPerformanceDir = makeAgentDir('agent-pan-1866-review-performance');
    const reviewRequirementsDir = makeAgentDir('agent-pan-1866-review-requirements');
    const otherReviewDir = makeAgentDir('agent-pan-1867-review');

    const result = await wipeAgentStateDirs('PAN-1866', { rolePrefix: 'review' });

    expect(result.removed).toContain('agent-pan-1866-review');
    expect(result.removed).toContain('agent-pan-1866-review-security');
    expect(result.removed).toContain('agent-pan-1866-review-correctness');
    expect(result.removed).toContain('agent-pan-1866-review-performance');
    expect(result.removed).toContain('agent-pan-1866-review-requirements');
    expect(result.removed).toHaveLength(5);
    expect(existsSync(reviewDir)).toBe(false);
    expect(existsSync(reviewSecurityDir)).toBe(false);
    expect(existsSync(reviewCorrectnessDir)).toBe(false);
    expect(existsSync(reviewPerformanceDir)).toBe(false);
    expect(existsSync(reviewRequirementsDir)).toBe(false);
    // The work agent dir MUST be left alone.
    expect(existsSync(workDir)).toBe(true);
    // A different issue's review dir is untouched.
    expect(existsSync(otherReviewDir)).toBe(true);
  });

  it('does not pick up dirs whose names merely contain the role string (no leading dash)', async () => {
    // The filter is `agent-<id>-<rolePrefix>` (exact) OR
    // `agent-<id>-<rolePrefix>-...` (dash-prefixed). So `agent-<id>-reviewable`
    // does NOT match rolePrefix='review' because the char after 'review' is 'a',
    // not '-' or end-of-string. Future roles that genuinely start with 'review-'
    // (e.g. 'review-tools') are intentionally caught by the dash prefix.
    const reviewDir = makeAgentDir('agent-pan-1866-review');
    const reviewableDir = makeAgentDir('agent-pan-1866-reviewable'); // 'a' after 'review' — NOT caught

    await wipeAgentStateDirs('PAN-1866', { rolePrefix: 'review' });

    expect(existsSync(reviewDir)).toBe(false);
    expect(existsSync(reviewableDir)).toBe(true);
  });
});

describe('wipeAgentStateDirs (PAN-1985) — input validation', () => {
  it('refuses invalid issueId shapes', async () => {
    await expect(wipeAgentStateDirs('not-an-id')).rejects.toThrow(/invalid issueId/i);
    await expect(wipeAgentStateDirs('')).rejects.toThrow(/invalid issueId/i);
    await expect(wipeAgentStateDirs('123')).rejects.toThrow(/invalid issueId/i); // bare numeric
    await expect(wipeAgentStateDirs('PAN-1866-dirty')).rejects.toThrow(/invalid issueId/i); // trailing junk
    await expect(wipeAgentStateDirs('PAN 1866')).rejects.toThrow(/invalid issueId/i); // space
    // Lowercase prefixes are accepted (the helper normalizes internally).
    const result = await wipeAgentStateDirs('pan-1866');
    expect(result.removed).toEqual([]);
  });

  it('refuses unsafe rolePrefix values', async () => {
    await expect(wipeAgentStateDirs('PAN-1866', { rolePrefix: '../etc' })).rejects.toThrow(/invalid rolePrefix/i);
    await expect(wipeAgentStateDirs('PAN-1866', { rolePrefix: 'review;DROP TABLE' })).rejects.toThrow(/invalid rolePrefix/i);
    await expect(wipeAgentStateDirs('PAN-1866', { rolePrefix: '' })).rejects.toThrow(/invalid rolePrefix/i);
  });
});
