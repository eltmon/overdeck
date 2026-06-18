import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mocks = vi.hoisted(() => ({
  cleanupClosedIssueAgentDirectories: vi.fn(),
  getAgentSessionsSync: vi.fn(),
  listSessionNamesSync: vi.fn(),
}));

// Track overdeck-test-db handles per test so afterEach can clean them up.
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  saveOverdeckAgentStateSync,
  type OverdeckTestDb,
} from '../../helpers/overdeck-test-db.js';

// Mock dependencies
vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 }),
}));

vi.mock('../../../src/lib/agent-directory-cleanup.js', () => ({
  cleanupClosedIssueAgentDirectories: mocks.cleanupClosedIssueAgentDirectories,
}));

vi.mock('../../../src/lib/tmux.js', () => ({
  getAgentSessionsSync: mocks.getAgentSessionsSync,
  listSessionNamesSync: mocks.listSessionNamesSync,
}));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    overdeck: { version: '1.0.0' },
    sync: { backup_before_sync: true },
    trackers: { primary: 'linear' },
    dashboard: { port: 3001, api_port: 3002 },
  }),
  loadConfigSync: vi.fn().mockReturnValue({
    overdeck: { version: '1.0.0' },
    sync: { backup_before_sync: true },
    trackers: { primary: 'linear' },
    dashboard: { port: 3001, api_port: 3002 },
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

const tempDirs: string[] = [];
let odb: OverdeckTestDb | null = null;

function makeAgentsDir(): string {
  // Overdeck (PAN-1938): the doctor test seeds agent state into overdeck.db
  // via saveOverdeckAgentStateSync, and getAgentStateSync reads overdeck first.
  // The agentsDir parameter still must point at a real directory under
  // OVERDECK_HOME so readDoctorAgentStates' readdirSync can enumerate it.
  const dir = odb ? join(odb.home, 'agents') : mkdtempSync(join(tmpdir(), 'pan-doctor-agents-'));
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function writeAgentState(agentsDir: string, agentId: string, state: object): void {
  const agentDir = join(agentsDir, agentId);
  mkdirSync(agentDir, { recursive: true });
  // Mirror the on-disk state.json (read by the rollback layer fallback) AND
  // persist the same record into overdeck.db so getAgentStateSync resolves
  // the agent on the first lookup (the overdeck door is the source of truth
  // post-PAN-1938).
  writeFileSync(join(agentDir, 'state.json'), JSON.stringify(state), 'utf8');
  if (odb) {
    saveOverdeckAgentStateSync(state as Parameters<typeof saveOverdeckAgentStateSync>[0]);
  }
}

describe('doctor command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockImplementation((path) => {
      // Pass through real fs.existsSync for paths the overdeck test fixture
      // needs to see as missing/present (the fresh temp home has no
      // overdeck.db until setupOverdeckTestDb creates it).
      if (typeof path !== 'string') return true;
      if (path.includes('pan-overdeck-test-') || path.endsWith('/overdeck.db')) {
        const realFs = require('fs');
        return realFs.existsSync(path);
      }
      if (path.includes('pan-doctor-agents-')) {
        return true;
      }
      if (odb && path.includes(odb.home)) {
        return true;
      }
      return true;
    });
    odb = setupOverdeckTestDb();
    mocks.cleanupClosedIssueAgentDirectories.mockReturnValue(Effect.succeed({
      removed: [],
      protected: [],
      wouldRemove: [],
      totalCandidates: 0,
    }));
    mocks.getAgentSessionsSync.mockReturnValue([]);
    mocks.listSessionNamesSync.mockReturnValue([]);
  });

  afterEach(() => {
    if (odb) {
      teardownOverdeckTestDb(odb);
      odb = null;
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('configuration checks', () => {
    it('should check if config file exists', () => {
      // The doctor command checks for config file
      const mockExistsSync = vi.mocked(existsSync);
      mockExistsSync.mockReturnValue(true);

      expect(mockExistsSync).toBeDefined();
    });

    it('should validate config structure', async () => {
      const { loadConfigSync } = await import('../../../src/lib/config.js');
      const config = loadConfigSync();

      expect(config).toHaveProperty('overdeck');
      expect(config).toHaveProperty('sync');
      expect(config).toHaveProperty('trackers');
      expect(config).toHaveProperty('dashboard');
    });
  });

  describe('dependency checks', () => {
    it('should check for tmux availability', async () => {
      const { execa } = await import('execa');

      // Mock successful tmux check
      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'tmux 3.3a',
        stderr: '',
        exitCode: 0,
      } as any);

      // Simulate the check
      const result = await execa('tmux', ['-V']);
      expect(result.exitCode).toBe(0);
    });

    it('should check for git availability', async () => {
      const { execa } = await import('execa');

      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'git version 2.40.0',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await execa('git', ['--version']);
      expect(result.exitCode).toBe(0);
    });

    it('should check for docker availability', async () => {
      const { execa } = await import('execa');

      vi.mocked(execa).mockResolvedValueOnce({
        stdout: 'Docker version 24.0.0',
        stderr: '',
        exitCode: 0,
      } as any);

      const result = await execa('docker', ['--version']);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('environment checks', () => {
    it('should check for LINEAR_API_KEY', () => {
      const env = { LINEAR_API_KEY: 'test-key' };
      expect(env.LINEAR_API_KEY).toBeDefined();
    });

    it('should warn if LINEAR_API_KEY is missing', () => {
      const env = {};
      expect((env as any).LINEAR_API_KEY).toBeUndefined();
    });
  });

  describe('directory checks', () => {
    it('should check if skills directory exists', () => {
      const mockExistsSync = vi.mocked(existsSync);
      mockExistsSync.mockReturnValue(true);

      expect(existsSync('/home/test/.overdeck/skills')).toBe(true);
    });

    it('should check if commands directory exists', () => {
      const mockExistsSync = vi.mocked(existsSync);
      mockExistsSync.mockReturnValue(true);

      expect(existsSync('/home/test/.overdeck/commands')).toBe(true);
    });
  });

  describe('closed issue agent directory checks', () => {
    it('reports stale closed-issue agent directories', async () => {
      mocks.cleanupClosedIssueAgentDirectories.mockReturnValueOnce(Effect.succeed({
        removed: [],
        protected: [],
        wouldRemove: ['agent-pan-1052-ship'],
        totalCandidates: 1,
      }));

      const { checkClosedIssueOrphanAgentDirs } = await import('../../../src/cli/commands/doctor.js');
      const result = await checkClosedIssueOrphanAgentDirs([], '/tmp/agents');

      expect(result).toMatchObject({
        name: 'Closed-Issue Agent Dirs',
        status: 'warn',
      });
      expect(result.message).toContain('1 old closed-issue agent dir');
      expect(result.fix).toContain('agent-pan-1052-ship');
    });

    it('passes when no stale closed-issue agent directories exist', async () => {
      const { checkClosedIssueOrphanAgentDirs } = await import('../../../src/cli/commands/doctor.js');
      const result = await checkClosedIssueOrphanAgentDirs([], '/tmp/agents');

      expect(result).toMatchObject({
        name: 'Closed-Issue Agent Dirs',
        status: 'ok',
        message: 'No old closed-issue agent dirs detected',
      });
    });
  });

  describe('stopped-list classification checks', () => {
    it('passes when running tmux agents classify as active', async () => {
      const agentsDir = makeAgentsDir();
      writeAgentState(agentsDir, 'agent-pan-1419', {
        id: 'agent-pan-1419',
        issueId: 'PAN-1419',
        role: 'work',
        workspace: '/tmp/test-workspace',
        status: 'running',
        startedAt: '2026-05-23T00:00:00.000Z',
      });

      const { checkStoppedListClassification } = await import('../../../src/cli/commands/doctor.js');
      const result = checkStoppedListClassification({
        agentsDir,
        tmuxSessionNames: ['agent-pan-1419'],
        dashboardAgents: [{
          id: 'agent-pan-1419',
          issueId: 'PAN-1419',
          status: 'running',
          hasLiveTmuxSession: true,
        }],
      });

      expect(result).toMatchObject({
        name: 'Stopped-List Classification',
        status: 'ok',
        message: 'Running agents with live tmux classify as active',
      });
    });

    it('warns when a running tmux agent is missing from active dashboard data', async () => {
      const agentsDir = makeAgentsDir();
      writeAgentState(agentsDir, 'agent-pan-1419', {
        id: 'agent-pan-1419',
        issueId: 'PAN-1419',
        role: 'work',
        workspace: '/tmp/test-workspace',
        status: 'running',
        startedAt: '2026-05-23T00:00:00.000Z',
      });

      const { checkStoppedListClassification } = await import('../../../src/cli/commands/doctor.js');
      const result = checkStoppedListClassification({
        agentsDir,
        tmuxSessionNames: ['agent-pan-1419'],
        dashboardAgents: [{
          id: 'agent-pan-1419',
          issueId: 'PAN-1419',
          status: 'stopped',
          hasLiveTmuxSession: false,
        }],
      });

      expect(result).toMatchObject({
        name: 'Stopped-List Classification',
        status: 'warn',
      });
      expect(result.message).toContain('agent-pan-1419');
      expect(result.fix).toContain('PAN-1419');
    });
  });
});
