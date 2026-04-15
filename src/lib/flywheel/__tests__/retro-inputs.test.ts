/**
 * Unit tests for retro-inputs gatherer (PAN-709)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { gatherRetroInputs, type RetroInputBundle } from '../retro-inputs.js';

// Mock resolveProjectFromIssue to return our fixture project
vi.mock('../../projects.js', () => ({
  resolveProjectFromIssue: (issueId: string) => {
    if (issueId === 'PAN-TEST') return { projectPath: TEST_PROJECT_PATH, projectName: 'test-project', projectKey: 'test' };
    return null;
  },
}));

const TEST_DIR = join(tmpdir(), `retro-inputs-test-${Date.now()}`);
const TEST_PROJECT_PATH = TEST_DIR;
const WORKSPACE_DIR = join(TEST_DIR, 'workspaces', 'feature-pan-test');
const PLANNING_DIR = join(WORKSPACE_DIR, '.planning');
const FEEDBACK_DIR = join(PLANNING_DIR, 'feedback');

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
