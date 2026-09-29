import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mocks = vi.hoisted(() => ({
  resolveProjectForIssue: vi.fn(),
  getProjectConfigFromWorkspacePath: vi.fn(),
}));

vi.mock('../../overdeck/issue-projects.js', () => ({
  resolveProjectForIssue: mocks.resolveProjectForIssue,
  getProjectConfigFromWorkspacePath: mocks.getProjectConfigFromWorkspacePath,
}));

import { resolveActiveTestSkipWaiver } from '../test-skip-waiver.js';
import { captureHandoffContext } from '../handoff-context.js';
import { writeContinueState } from '../../xbrief/continue-state.js';
import type { AgentState } from '../../agents.js';

let TEST_DIR: string;
const issueId = 'PAN-4242';

function workspaceDir(): string {
  return join(TEST_DIR, 'workspaces', 'feature-pan-4242');
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'continue-readers-plan-home-'));
  mocks.resolveProjectForIssue.mockReturnValue({ path: TEST_DIR });
  mocks.getProjectConfigFromWorkspacePath.mockReturnValue({ path: TEST_DIR });
});

afterEach(() => {
  vi.clearAllMocks();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('resolveActiveTestSkipWaiver reads the workspace continue file (PAN-4225 ac1)', () => {
  it('finds a D-test-removal-waived decision that exists only in the workspace copy', () => {
    mkdirSync(workspaceDir(), { recursive: true });
    const sha = 'abc123';
    const now = new Date().toISOString();
    writeContinueState(workspaceDir(), issueId, {
      version: '1',
      issueId,
      created: now,
      updated: now,
      gitState: {},
      decisions: [{ id: `D-test-removal-waived:${sha}`, summary: 'covered elsewhere', recordedAt: now }],
      hazards: [],
      resumePoint: null,
      sessionHistory: [],
    });

    const waiver = resolveActiveTestSkipWaiver(issueId, sha);

    expect(waiver?.sha).toBe(sha);
  });
});

describe('captureHandoffContext reads the workspace continue file (PAN-4225 ac2)', () => {
  it('surfaces decisions recorded only in the workspace continue file', async () => {
    mkdirSync(workspaceDir(), { recursive: true });
    const now = new Date().toISOString();
    writeContinueState(workspaceDir(), issueId, {
      version: '1',
      issueId,
      created: now,
      updated: now,
      gitState: {},
      decisions: [{ id: 'D1', summary: 'a decision', recordedAt: now }],
      hazards: [],
      resumePoint: null,
      sessionHistory: [],
    });

    const agentState = {
      id: `agent-${issueId.toLowerCase()}`,
      issueId,
      workspace: workspaceDir(),
      model: 'claude',
      harness: 'claude-code',
    } as unknown as AgentState;

    const context = await captureHandoffContext(agentState, 'claude', 'test handoff');

    expect(context.continueState?.decisions[0]?.id).toBe('D1');
  });
});
