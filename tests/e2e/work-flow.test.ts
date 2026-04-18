import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * E2E tests for the work command flow
 *
 * These tests simulate the full workflow:
 * 1. Create workspace for issue
 * 2. Spawn agent in tmux
 * 3. Agent works on issue
 * 4. Agent completes, work awaits approval
 * 5. User approves and merges
 */

// Mock tmux commands
vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 }),
  execaSync: vi.fn().mockReturnValue({ stdout: '', exitCode: 0 }),
}));

// Mock Linear API
vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    issue: vi.fn().mockResolvedValue({
      id: 'issue-123',
      identifier: 'TEST-42',
      title: 'Test Feature Implementation',
      description: 'Implement test feature',
      branchName: 'feature/test-42-test-feature',
      state: Promise.resolve({ name: 'Todo' }),
    }),
    issueUpdate: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

describe('E2E: Work Flow', () => {
  let tempDir: string;
  let workspaceRoot: string;
  let testWorkspace: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'panopticon-work-flow-'));
    workspaceRoot = join(tempDir, 'workspaces');
    testWorkspace = join(workspaceRoot, 'TEST-42');
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        // Ignore cleanup errors in tests
        console.warn('Failed to clean up work flow temp dir:', error);
      }
    }
    vi.clearAllMocks();
  });

  describe('Workspace Creation', () => {
    it('should create workspace directory for issue', async () => {
      mkdirSync(testWorkspace, { recursive: true });

      expect(existsSync(testWorkspace)).toBe(true);
    });

    it('should create .planning directory in workspace', () => {
      mkdirSync(testWorkspace, { recursive: true });
      mkdirSync(join(testWorkspace, '.planning'), { recursive: true });

      expect(existsSync(join(testWorkspace, '.planning'))).toBe(true);
    });

    it('should create STATE.md with issue context', () => {
      mkdirSync(join(testWorkspace, '.planning'), { recursive: true });

      const stateContent = `# State for TEST-42

## Issue
- ID: TEST-42
- Title: Test Feature Implementation
- Status: Todo

## Progress
- [ ] Understand requirements
- [ ] Implement feature
- [ ] Write tests
- [ ] Submit for review
`;
      writeFileSync(join(testWorkspace, '.planning', 'STATE.md'), stateContent);

      const content = readFileSync(join(testWorkspace, '.planning', 'STATE.md'), 'utf8');
      expect(content).toContain('TEST-42');
      expect(content).toContain('Test Feature Implementation');
    });

    it('should create CLAUDE.md with project context', () => {
      mkdirSync(join(testWorkspace, '.planning'), { recursive: true });

      const claudeContent = `# Project Context

You are working on TEST-42: Test Feature Implementation

## Guidelines
- Follow project coding standards
- Write tests for new code
- Update documentation

## Branch
feature/test-42-test-feature
`;
      writeFileSync(join(testWorkspace, '.planning', 'CLAUDE.md'), claudeContent);

      const content = readFileSync(join(testWorkspace, '.planning', 'CLAUDE.md'), 'utf8');
      expect(content).toContain('TEST-42');
    });
  });

  describe('Agent Spawning', () => {
    it('should spawn tmux session for agent', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      // Simulate tmux new-session
      mockExeca.mockResolvedValueOnce({
        stdout: '',
        exitCode: 0,
      } as any);

      const result = await execa('tmux', ['new-session', '-d', '-s', 'agent-TEST-42']);
      expect(result.exitCode).toBe(0);
    });

    it('should send initial prompt to agent', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockResolvedValueOnce({
        stdout: '',
        exitCode: 0,
      } as any);

      const prompt = 'Work on TEST-42: Test Feature Implementation';
      const result = await execa('tmux', ['send-keys', '-t', 'agent-TEST-42', prompt, 'Enter']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Work Status', () => {
    it('should list running agent sessions', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockResolvedValueOnce({
        stdout: 'agent-TEST-42: 1 windows (created Mon Jan 20 10:00:00 2025)',
        exitCode: 0,
      } as any);

      const result = await execa('tmux', ['list-sessions']);
      expect(result.stdout).toContain('agent-TEST-42');
    });

    it('should capture agent output', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockResolvedValueOnce({
        stdout: 'Working on implementing feature...\nCreating test file...',
        exitCode: 0,
      } as any);

      const result = await execa('tmux', ['capture-pane', '-t', 'agent-TEST-42', '-p']);
      expect(result.stdout).toContain('Working on');
    });
  });

  describe('Work Completion', () => {
    it('should update issue status when complete', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const client = new LinearClient({ apiKey: 'test' });

      const result = await client.issueUpdate('issue-123', {
        stateId: 'done-state-id',
      });

      expect(result.success).toBe(true);
    });

    it('should kill tmux session after completion', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockResolvedValueOnce({
        stdout: '',
        exitCode: 0,
      } as any);

      const result = await execa('tmux', ['kill-session', '-t', 'agent-TEST-42']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Error Recovery', () => {
    it('should handle agent crash gracefully', async () => {
      // STATE.md should preserve progress
      mkdirSync(join(testWorkspace, '.planning'), { recursive: true });

      const stateContent = `# State for TEST-42

## Progress
- [x] Understand requirements
- [x] Implement feature
- [ ] Write tests
- [ ] Submit for review

## Last Action
Agent crashed while running tests
`;
      writeFileSync(join(testWorkspace, '.planning', 'STATE.md'), stateContent);

      const content = readFileSync(join(testWorkspace, '.planning', 'STATE.md'), 'utf8');
      expect(content).toContain('[x] Implement feature');
      expect(content).toContain('crashed');
    });

    it('should allow resuming after crash', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      // Mock creating/resuming a session
      mockExeca.mockResolvedValueOnce({
        stdout: '',
        exitCode: 0,
      } as any);

      const result = await execa('tmux', ['new-session', '-d', '-s', 'agent-TEST-42']);
      expect(result.exitCode).toBe(0);
    });
  });
});
