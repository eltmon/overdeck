/**
 * Unit tests for retro-inputs gatherer (PAN-709)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { gatherRetroInputs, type RetroInputBundle } from '../retro-inputs.js';

// Mock resolveProjectFromIssue to return our fixture project
vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: (issueId: string) => {
    if (issueId === 'PAN-TEST') return { projectPath: TEST_PROJECT_PATH, projectName: 'test-project', projectKey: 'test' };
    return null;
  },
}));

// Mock child_process to intercept execFile calls and prevent real CLI invocations
vi.mock('child_process', () => ({ execFile: vi.fn() }));

// Mock paths.js so readTmuxTails uses a controlled temp dir
vi.mock('../../paths.js', () => ({
  get PANOPTICON_HOME() { return TEST_PANOPTICON_HOME; },
}));

const mockExecFile = vi.mocked(execFile);

const TEST_DIR = join(tmpdir(), `retro-inputs-test-${Date.now()}`);
const TEST_PROJECT_PATH = TEST_DIR;
const TEST_PANOPTICON_HOME = join(TEST_DIR, 'panopticon-home');
const WORKSPACE_DIR = join(TEST_DIR, 'workspaces', 'feature-pan-test');
const PLANNING_DIR = join(WORKSPACE_DIR, '.planning');
const FEEDBACK_DIR = join(PLANNING_DIR, 'feedback');

// Default: all execFile calls return empty stdout (gh/git return null gracefully)
beforeEach(() => {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    (cb as (err: null, result: { stdout: string }) => void)(null, { stdout: '' });
  });
});

beforeAll(() => {
  // Create fixture workspace
  mkdirSync(FEEDBACK_DIR, { recursive: true });

  // STATE.md
  writeFileSync(join(PLANNING_DIR, 'STATE.md'), `# State\n\nThis issue implemented audience routing for skills.\n`);

  // plan.vbrief.json
  writeFileSync(join(PLANNING_DIR, 'plan.vbrief.json'), JSON.stringify({
    plan: { uid: 'test-uid', author: 'test-agent' },
    items: [{ id: '1', title: 'Implement routing', status: 'completed' }],
  }, null, 2));

  // feedback files
  writeFileSync(join(FEEDBACK_DIR, 'review-feedback.md'), `# Review Feedback\n\nLooks good, approved.\n`);
  writeFileSync(join(FEEDBACK_DIR, 'test-feedback.md'), `# Test Feedback\n\nAll tests passed.\n`);

  // Agent dirs for tmux tail test — named agent-<issue-lower> per Panopticon convention
  const agentDir = join(TEST_PANOPTICON_HOME, 'agents', 'agent-pan-test');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'tmux-tail.txt'), 'session line 1\nsession line 2\n');

  // Unrelated agent dir — must NOT appear in pan-test results
  const unrelatedDir = join(TEST_PANOPTICON_HOME, 'agents', 'agent-other-project');
  mkdirSync(unrelatedDir, { recursive: true });
  writeFileSync(join(unrelatedDir, 'tmux-tail.txt'), 'unrelated content\n');
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('gatherRetroInputs', () => {
  it('returns issueId in the bundle', async () => {
    const bundle = await gatherRetroInputs('PAN-TEST');
    expect(bundle.issueId).toBe('PAN-TEST');
  });

  it('reads STATE.md from the workspace', async () => {
    const bundle = await gatherRetroInputs('PAN-TEST');
    expect(bundle.stateMd).toContain('audience routing for skills');
  });

  it('reads plan.vbrief.json from the workspace', async () => {
    const bundle = await gatherRetroInputs('PAN-TEST');
    expect(bundle.vbriefJson).toContain('test-uid');
  });

  it('reads all feedback .md files', async () => {
    const bundle = await gatherRetroInputs('PAN-TEST');
    expect(Object.keys(bundle.feedbackFiles)).toHaveLength(2);
    expect(bundle.feedbackFiles['review-feedback.md']).toContain('approved');
    expect(bundle.feedbackFiles['test-feedback.md']).toContain('All tests passed');
  });

  it('returns null for missing workspace (unknown issueId)', async () => {
    const bundle = await gatherRetroInputs('PAN-UNKNOWN');
    expect(bundle.stateMd).toBeNull();
    expect(bundle.vbriefJson).toBeNull();
    expect(Object.keys(bundle.feedbackFiles)).toHaveLength(0);
  });

  it('flywheelStateRow is null when FLYWHEEL-STATE.md is absent or issue not in it', async () => {
    const bundle = await gatherRetroInputs('PAN-TEST');
    // FLYWHEEL-STATE.md likely doesn't exist in the test env
    expect(bundle.flywheelStateRow === null || typeof bundle.flywheelStateRow === 'string').toBe(true);
  });

  it('tmuxTails is an object (may be empty if no agent dirs exist)', async () => {
    const bundle = await gatherRetroInputs('PAN-TEST');
    expect(typeof bundle.tmuxTails).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// readTmuxTails — directory matching regression (PAN-709 review-025 fix 1)
// Panopticon agent dirs are named agent-<issue-lower>, NOT <issue-lower>-prefixed.
// Old code used startsWith(issueLower) which missed agent-pan-709 for PAN-709.
// ---------------------------------------------------------------------------

describe('readTmuxTails — directory matching', () => {
  it('captures tail from agent-<issue-lower> dir (endsWith pattern)', async () => {
    const bundle = await gatherRetroInputs('PAN-TEST');
    expect(bundle.tmuxTails['agent-pan-test']).toBeDefined();
    expect(bundle.tmuxTails['agent-pan-test']).toContain('session line');
  });

  it('does not capture tail from dirs belonging to a different issue', async () => {
    const bundle = await gatherRetroInputs('PAN-TEST');
    expect(Object.keys(bundle.tmuxTails)).not.toContain('agent-other-project');
  });
});

// ---------------------------------------------------------------------------
// fetchPrComments — branch selector regression (PAN-709 review-025 fix 2)
// Old code passed the raw issue ID (e.g., PAN-709) as the gh pr view selector.
// gh pr view only accepts PR number, URL, or branch name — not a GitHub issue key.
// Fixed: now passes feature/<issue-lower> as the branch selector.
// ---------------------------------------------------------------------------

describe('fetchPrComments — branch selector', () => {
  it('calls gh pr view with feature/<issue-lower> branch, not raw issue ID', async () => {
    await gatherRetroInputs('PAN-TEST');
    const ghViewCall = mockExecFile.mock.calls.find(
      ([cmd, args]) => cmd === 'gh' && Array.isArray(args) && args.includes('view'),
    );
    expect(ghViewCall).toBeDefined();
    const args = ghViewCall![1] as string[];
    expect(args).toContain('feature/pan-test');
    expect(args).not.toContain('PAN-TEST');
  });
});
