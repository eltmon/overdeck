import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as childProcess from 'child_process';
import {
  listLogsCommand,
  viewLogCommand,
  tailLogCommand,
  logsCommand,
  cleanupLogsCommand,
} from '../../../../src/cli/commands/specialists/logs.js';

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code?: any) => {
  throw new Error(`process.exit(${code})`);
});

// Mock child_process
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('child_process');
  return {
    ...actual,
    exec: vi.fn(),
    spawn: vi.fn(),
  };
});

// Mock specialist-logs module
const mockListRunLogs = vi.fn();
const mockGetRunLog = vi.fn();
const mockCleanupOldLogs = vi.fn();
const mockCleanupAllLogs = vi.fn();

vi.mock('../../../../src/lib/cloister/specialist-logs.js', () => ({
  listRunLogs: mockListRunLogs,
  listRunLogsSync: mockListRunLogs,
  getRunLog: mockGetRunLog,
  getRunLogSync: mockGetRunLog,
  parseLogMetadata: vi.fn(),
  getRunLogPath: vi.fn(),
  cleanupOldLogs: mockCleanupOldLogs,
  cleanupOldLogsSync: mockCleanupOldLogs,
  cleanupAllLogs: mockCleanupAllLogs,
  cleanupAllLogsSync: mockCleanupAllLogs,
}));

// Mock specialists module
vi.mock('../../../../src/lib/cloister/specialists.js', () => ({
  getProjectSpecialistMetadata: vi.fn(),
}));

// Mock projects module
vi.mock('../../../../src/lib/projects.js', () => ({
  getSpecialistRetention: vi.fn(() => ({ max_days: 30, max_runs: 100 })),
}));

describe('specialist logs CLI commands', () => {
  const testDir = join(tmpdir(), 'panopticon-test-cli-logs');

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
    mockExit.mockClear();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('listLogsCommand', () => {
    it('should list runs with status emojis', async () => {
      const { listRunLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(listRunLogsSync).mockReturnValue([
        {
          runId: '2024-01-01T12-00-00-TEST-1',
          filePath: '/path/to/log',
          metadata: {
            runId: '2024-01-01T12-00-00-TEST-1',
            project: 'testproject',
            specialistType: 'review-agent',
            issueId: 'TEST-1',
            startedAt: '2024-01-01T12:00:00Z',
            finishedAt: '2024-01-01T12:05:00Z',
            status: 'passed',
            duration: 300000,
            notes: 'All good',
          },
          fileSize: 1024,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        },
      ]);

      await listLogsCommand('testproject', 'review-agent', {});

      expect(listRunLogsSync).toHaveBeenCalledWith('testproject', 'review-agent', { limit: 10 });
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Recent runs'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('TEST-1'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('✅'));
    });

    it('should show message when no runs found', async () => {
      const { listRunLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(listRunLogsSync).mockReturnValue([]);

      await listLogsCommand('testproject', 'review-agent', {});

      expect(mockConsoleLog).toHaveBeenCalledWith('No runs found for testproject/review-agent');
    });

    it('should output JSON when --json flag is set', async () => {
      const { listRunLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      const mockRuns = [
        {
          runId: '2024-01-01T12-00-00-TEST-1',
          filePath: '/path/to/log',
          metadata: {
            runId: '2024-01-01T12-00-00-TEST-1',
            project: 'testproject',
            specialistType: 'review-agent',
            issueId: 'TEST-1',
            startedAt: '2024-01-01T12:00:00Z',
            status: 'passed',
          },
          fileSize: 1024,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        },
      ];
      vi.mocked(listRunLogsSync).mockReturnValue(mockRuns);

      await listLogsCommand('testproject', 'review-agent', { json: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(mockRuns, null, 2));
    });

    it('should use custom limit if provided', async () => {
      const { listRunLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(listRunLogsSync).mockReturnValue([]);

      await listLogsCommand('testproject', 'review-agent', { limit: '5' });

      expect(listRunLogsSync).toHaveBeenCalledWith('testproject', 'review-agent', { limit: 5 });
    });

    it('should handle errors and exit', async () => {
      const { listRunLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(listRunLogsSync).mockImplementation(() => {
        throw new Error('Test error');
      });

      await expect(listLogsCommand('testproject', 'review-agent', {})).rejects.toThrow('process.exit');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Error listing logs'),
        expect.any(String)
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should show all status types with correct emojis', async () => {
      const { listRunLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(listRunLogsSync).mockReturnValue([
        {
          runId: 'run1',
          filePath: '/path/to/log1',
          metadata: {
            runId: 'run1',
            project: 'testproject',
            specialistType: 'review-agent',
            issueId: 'TEST-1',
            startedAt: '2024-01-01T12:00:00Z',
            status: 'passed',
          },
          fileSize: 1024,
          createdAt: new Date(),
        },
        {
          runId: 'run2',
          filePath: '/path/to/log2',
          metadata: {
            runId: 'run2',
            project: 'testproject',
            specialistType: 'review-agent',
            issueId: 'TEST-2',
            startedAt: '2024-01-01T12:00:00Z',
            status: 'failed',
          },
          fileSize: 1024,
          createdAt: new Date(),
        },
        {
          runId: 'run3',
          filePath: '/path/to/log3',
          metadata: {
            runId: 'run3',
            project: 'testproject',
            specialistType: 'review-agent',
            issueId: 'TEST-3',
            startedAt: '2024-01-01T12:00:00Z',
            status: 'blocked',
          },
          fileSize: 1024,
          createdAt: new Date(),
        },
      ]);

      await listLogsCommand('testproject', 'review-agent', {});

      const allLogs = mockConsoleLog.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(allLogs).toContain('✅');
      expect(allLogs).toContain('❌');
      expect(allLogs).toContain('⚠️');
    });
  });

  describe('viewLogCommand', () => {
    it('should display log content when less is not available', { timeout: 30000 }, async () => {
      const { getRunLogSync, getRunLogPath } = await import('../../../../src/lib/cloister/specialist-logs.js');
      const testContent = '# Test Log\n\nLog content here';
      vi.mocked(getRunLogSync).mockReturnValue(testContent);
      vi.mocked(getRunLogPath).mockReturnValue('/path/to/log');

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        setImmediate(() => callback(new Error('less not found'), { stdout: '', stderr: '' }));
        return {} as any;
      }) as any);

      await viewLogCommand('testproject', 'review-agent', 'run-id', {});

      expect(mockConsoleLog).toHaveBeenCalledWith(testContent);
    });

    it('should use less for viewing when available', { timeout: 30000 }, async () => {
      const { getRunLogSync, getRunLogPath } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(getRunLogSync).mockReturnValue('test content');
      vi.mocked(getRunLogPath).mockReturnValue('/path/to/log');

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        setImmediate(() => callback(null, { stdout: '', stderr: '' }));
        return {} as any;
      }) as any);

      await viewLogCommand('testproject', 'review-agent', 'run-id', {});

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('less'),
        expect.any(Function)
      );
    });

    it('should output JSON when --json flag is set', async () => {
      const { getRunLogSync, parseLogMetadata } = await import('../../../../src/lib/cloister/specialist-logs.js');
      const testContent = '# Test Log';
      const testMetadata = {
        runId: 'run-id',
        project: 'testproject',
        specialistType: 'review-agent',
        issueId: 'TEST-1',
        startedAt: '2024-01-01T12:00:00Z',
        status: 'passed' as const,
      };

      vi.mocked(getRunLogSync).mockReturnValue(testContent);
      vi.mocked(parseLogMetadata).mockReturnValue(testMetadata);

      await viewLogCommand('testproject', 'review-agent', 'run-id', { json: true });

      expect(mockConsoleLog).toHaveBeenCalledWith(
        JSON.stringify({ runId: 'run-id', content: testContent, metadata: testMetadata }, null, 2)
      );
    });

    it('should exit with error when log not found', async () => {
      const { getRunLogSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(getRunLogSync).mockReturnValue(null);

      await expect(viewLogCommand('testproject', 'review-agent', 'nonexistent', {})).rejects.toThrow(
        'process.exit'
      );

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Run log not found: nonexistent')
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('tailLogCommand', () => {
    it('should tail active run log', async () => {
      const { getRunLogPath } = await import('../../../../src/lib/cloister/specialist-logs.js');
      const { getProjectSpecialistMetadata } = await import('../../../../src/lib/cloister/specialists.js');

      vi.mocked(getProjectSpecialistMetadata).mockReturnValue({
        currentRun: '2024-01-01T12-00-00-TEST-1',
        activeSession: 'session-123',
        gracePeriod: null,
      } as any);

      const logPath = join(testDir, 'test.log');
      vi.mocked(getRunLogPath).mockReturnValue(logPath);

      // Create the log file
      mkdirSync(testDir, { recursive: true });
      require('fs').writeFileSync(logPath, 'test log content');

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockTailProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 10);
          }
          return mockTailProcess;
        }),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockTailProcess as any);

      await tailLogCommand('testproject', 'review-agent');

      expect(mockSpawn).toHaveBeenCalledWith('tail', ['-f', logPath], { stdio: 'inherit' });
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Following'));
    });

    it('should exit with error when no active run', async () => {
      const { getProjectSpecialistMetadata } = await import('../../../../src/lib/cloister/specialists.js');

      vi.mocked(getProjectSpecialistMetadata).mockReturnValue({
        currentRun: null,
        activeSession: null,
        gracePeriod: null,
      } as any);

      await expect(tailLogCommand('testproject', 'review-agent')).rejects.toThrow('process.exit');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('No active run for testproject/review-agent')
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should exit with error when log file not found', async () => {
      const { getRunLogPath } = await import('../../../../src/lib/cloister/specialist-logs.js');
      const { getProjectSpecialistMetadata } = await import('../../../../src/lib/cloister/specialists.js');

      vi.mocked(getProjectSpecialistMetadata).mockReturnValue({
        currentRun: '2024-01-01T12-00-00-TEST-1',
        activeSession: 'session-123',
        gracePeriod: null,
      } as any);

      vi.mocked(getRunLogPath).mockReturnValue('/nonexistent/path/to/log');

      await expect(tailLogCommand('testproject', 'review-agent')).rejects.toThrow('process.exit');

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Log file not found'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('cleanupLogsCommand', () => {
    it('should clean up logs for single project with --force', async () => {
      const { cleanupOldLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(cleanupOldLogsSync).mockReturnValue(5);

      await cleanupLogsCommand('testproject', 'review-agent', { force: true });

      expect(cleanupOldLogsSync).toHaveBeenCalledWith('testproject', 'review-agent', {
        maxDays: 30,
        maxRuns: 100,
      });
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Deleted 5 old logs'));
    });

    it('should exit without --force flag for single project', async () => {
      await expect(cleanupLogsCommand('testproject', 'review-agent', {})).rejects.toThrow('process.exit');

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Use --force to confirm'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should clean up all logs with --all --force', async () => {
      const { cleanupAllLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(cleanupAllLogsSync).mockReturnValue({
        totalDeleted: 15,
        byProject: {
          project1: {
            'review-agent': 10,
            'test-agent': 5,
          },
        },
      });

      await cleanupLogsCommand('--all', undefined, { force: true } as any);

      expect(cleanupAllLogsSync).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('deleted 15 old logs'));
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('project1/review-agent: 10'));
    });

    it('should exit without --force flag for --all', async () => {
      await expect(cleanupLogsCommand('--all', undefined, {})).rejects.toThrow('process.exit');

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Use --force to confirm'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should exit with error when missing arguments', async () => {
      await expect(cleanupLogsCommand(undefined, undefined, {})).rejects.toThrow('process.exit');

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('logsCommand', () => {
    it('should route to listLogsCommand for project + type', async () => {
      const { listRunLogsSync } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(listRunLogsSync).mockReturnValue([]);

      await logsCommand('testproject', 'review-agent', {}, {});

      expect(listRunLogsSync).toHaveBeenCalledWith('testproject', 'review-agent', { limit: 10 });
    });

    it('should route to viewLogCommand for project + type + runId', { timeout: 30000 }, async () => {
      const { getRunLogSync, getRunLogPath } = await import('../../../../src/lib/cloister/specialist-logs.js');
      vi.mocked(getRunLogSync).mockReturnValue('log content');
      vi.mocked(getRunLogPath).mockReturnValue('/path/to/log');

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        setImmediate(() => callback(new Error('less not found'), { stdout: '', stderr: '' }));
        return {} as any;
      }) as any);

      await logsCommand('testproject', 'review-agent', 'run-id', {});

      expect(getRunLogSync).toHaveBeenCalledWith('testproject', 'review-agent', 'run-id');
    });

    it('should route to tailLogCommand for --tail mode', async () => {
      const { getRunLogPath } = await import('../../../../src/lib/cloister/specialist-logs.js');
      const { getProjectSpecialistMetadata } = await import('../../../../src/lib/cloister/specialists.js');

      vi.mocked(getProjectSpecialistMetadata).mockReturnValue({
        currentRun: '2024-01-01T12-00-00-TEST-1',
        activeSession: 'session-123',
        gracePeriod: null,
      } as any);

      const logPath = join(testDir, 'tail-test.log');
      vi.mocked(getRunLogPath).mockReturnValue(logPath);
      mkdirSync(testDir, { recursive: true });
      require('fs').writeFileSync(logPath, 'test log content');

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockTailProcess = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 10);
          }
          return mockTailProcess;
        }),
        kill: vi.fn(),
      };
      mockSpawn.mockReturnValue(mockTailProcess as any);

      await logsCommand({ tail: true }, 'testproject', 'review-agent', {});

      expect(mockSpawn).toHaveBeenCalledWith('tail', ['-f', logPath], { stdio: 'inherit' });
    });

    it('should exit with error for invalid --tail usage', async () => {
      await expect(logsCommand({ tail: true }, undefined, {}, {})).rejects.toThrow('process.exit');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Usage: pan specialists logs --tail')
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should exit with error when missing type for list mode', async () => {
      await expect(logsCommand('testproject', undefined, {}, {})).rejects.toThrow('process.exit');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Usage: pan specialists logs <project> <type>')
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });
});
