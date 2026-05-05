import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as childProcess from 'child_process';

// Make fs properties mockable by wrapping the module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual };
});
import {
  getContextDirectory,
  getContextDigestPath,
  loadContextDigest,
  generateContextDigest,
  regenerateContextDigest,
  scheduleDigestGeneration,
  hasContextDigest,
  deleteContextDigest,
} from '../../../src/lib/cloister/specialist-context.js';
import * as specialistLogs from '../../../src/lib/cloister/specialist-logs.js';

// Mock child_process exec
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('child_process');
  return {
    ...actual,
    exec: vi.fn(),
  };
});

// Mock projects module
vi.mock('../../../src/lib/projects.js', () => ({
  getProject: vi.fn((projectKey: string) => {
    if (projectKey === 'testproject') {
      return {
        key: 'testproject',
        name: 'Test Project',
        specialists: {
          context_runs: 3,
          digest_model: 'claude-sonnet-4-5',
        },
      };
    }
    return null;
  }),
}));

// Mock work-type-router module
vi.mock('../../../src/lib/work-type-router.js', () => ({
  getModelId: vi.fn(() => 'claude-sonnet-4-5'),
}));

describe('specialist-context', () => {
  let testDir: string;
  const originalPanopticonHome = process.env.PANOPTICON_HOME;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'panopticon-test-context-'));
    process.env.PANOPTICON_HOME = testDir;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    process.env.PANOPTICON_HOME = originalPanopticonHome;
  });

  describe('getContextDirectory', () => {
    it('should return correct context directory path', () => {
      const path = getContextDirectory('myproject', 'review-agent');
      expect(path).toContain('myproject');
      expect(path).toContain('review-agent');
      expect(path).toContain('context');
      expect(path).toMatch(/specialists\/myproject\/review-agent\/context$/);
    });
  });

  describe('getContextDigestPath', () => {
    it('should return correct digest file path', () => {
      const path = getContextDigestPath('myproject', 'review-agent');
      expect(path).toContain('myproject');
      expect(path).toContain('review-agent');
      expect(path).toContain('context');
      expect(path).toMatch(/latest-digest\.md$/);
    });
  });

  describe('loadContextDigest', () => {
    it('should return null if digest does not exist', () => {
      const digest = loadContextDigest('testproject', 'review-agent');
      expect(digest).toBeNull();
    });

    it('should load existing digest', () => {
      const contextDir = getContextDirectory('testproject', 'review-agent');
      mkdirSync(contextDir, { recursive: true });

      const digestPath = getContextDigestPath('testproject', 'review-agent');
      const testContent = '# Test Digest\n\nThis is a test digest.';
      writeFileSync(digestPath, testContent, 'utf-8');

      const digest = loadContextDigest('testproject', 'review-agent');
      expect(digest).toBe(testContent);
    });

    it('should return null on read error', () => {
      const contextDir = getContextDirectory('testproject', 'review-agent');
      mkdirSync(contextDir, { recursive: true });

      const digestPath = getContextDigestPath('testproject', 'review-agent');
      // Create a file with no read permissions (if possible)
      writeFileSync(digestPath, 'test', 'utf-8');

      // Mock readFileSync to throw via the mocked fs module
      vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw new Error('Read error');
      });

      const digest = loadContextDigest('testproject', 'review-agent');
      expect(digest).toBeNull();

      vi.restoreAllMocks();
    });
  });

  describe('hasContextDigest', () => {
    it('should return false if digest does not exist', () => {
      expect(hasContextDigest('testproject', 'review-agent')).toBe(false);
    });

    it('should return true if digest exists', () => {
      const contextDir = getContextDirectory('testproject', 'review-agent');
      mkdirSync(contextDir, { recursive: true });

      const digestPath = getContextDigestPath('testproject', 'review-agent');
      writeFileSync(digestPath, 'test digest', 'utf-8');

      expect(hasContextDigest('testproject', 'review-agent')).toBe(true);
    });
  });

  describe('deleteContextDigest', () => {
    it('should return false if digest does not exist', () => {
      const result = deleteContextDigest('testproject', 'review-agent');
      expect(result).toBe(false);
    });

    it('should delete existing digest and return true', () => {
      const contextDir = getContextDirectory('testproject', 'review-agent');
      mkdirSync(contextDir, { recursive: true });

      const digestPath = getContextDigestPath('testproject', 'review-agent');
      writeFileSync(digestPath, 'test digest', 'utf-8');

      expect(existsSync(digestPath)).toBe(true);

      const result = deleteContextDigest('testproject', 'review-agent');
      expect(result).toBe(true);
      expect(existsSync(digestPath)).toBe(false);
    });

    it('should return false on delete error', () => {
      const contextDir = getContextDirectory('testproject', 'review-agent');
      mkdirSync(contextDir, { recursive: true });

      const digestPath = getContextDigestPath('testproject', 'review-agent');
      writeFileSync(digestPath, 'test digest', 'utf-8');

      // Mock unlinkSync to throw via the mocked fs module
      vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => {
        throw new Error('Delete error');
      });

      const result = deleteContextDigest('testproject', 'review-agent');
      expect(result).toBe(false);

      vi.restoreAllMocks();
    });
  });

  describe('generateContextDigest', () => {
    beforeEach(() => {
      // Mock getRecentRunLogs to return some test runs
      vi.spyOn(specialistLogs, 'getRecentRunLogs').mockReturnValue([
        {
          runId: '2024-01-01T12-00-00-TEST-1',
          filePath: join(testDir, 'run1.log'),
          metadata: {
            runId: '2024-01-01T12-00-00-TEST-1',
            project: 'testproject',
            specialistType: 'review-agent',
            issueId: 'TEST-1',
            startedAt: '2024-01-01T12:00:00Z',
            finishedAt: '2024-01-01T12:05:00Z',
            status: 'passed',
            duration: 300000,
            notes: 'Review completed successfully',
          },
          fileSize: 1024,
          createdAt: new Date('2024-01-01T12:00:00Z'),
        },
      ]);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return null if no recent runs and not forced', async () => {
      vi.spyOn(specialistLogs, 'getRecentRunLogs').mockReturnValue([]);

      const digest = await generateContextDigest('testproject', 'review-agent');
      expect(digest).toBeNull();
    });

    it('should generate digest with force even if no runs', async () => {
      vi.spyOn(specialistLogs, 'getRecentRunLogs').mockReturnValue([]);

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, '# Generated Digest\n\nTest digest content', '');
        }
        return {} as any;
      });

      const digest = await generateContextDigest('testproject', 'review-agent', { force: true });
      expect(digest).toBeTruthy();
      expect(digest).toContain('Generated Digest');
    });

    it('should generate and save digest from recent runs', async () => {
      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, '# Test Digest\n\nDigest content here', '');
        }
        return {} as any;
      });

      const digest = await generateContextDigest('testproject', 'review-agent');

      expect(digest).toBeTruthy();
      expect(digest).toContain('Test Digest');

      // Verify digest was saved
      const digestPath = getContextDigestPath('testproject', 'review-agent');
      expect(existsSync(digestPath)).toBe(true);
      const savedDigest = readFileSync(digestPath, 'utf-8');
      expect(savedDigest).toBe(digest);
    });

    it('should use custom run count if provided', async () => {
      const mockGetRecentRuns = vi.spyOn(specialistLogs, 'getRecentRunLogs');

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, 'digest', '');
        }
        return {} as any;
      });

      await generateContextDigest('testproject', 'review-agent', { runCount: 10 });

      expect(mockGetRecentRuns).toHaveBeenCalledWith('testproject', 'review-agent', 10);
    });

    it('should use custom model if provided', async () => {
      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, 'digest', '');
        }
        return {} as any;
      });

      await generateContextDigest('testproject', 'review-agent', { model: 'claude-opus-4-6' });

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('--model claude-opus-4-6'),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should return null if exec fails', async () => {
      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(new Error('Exec failed'), '', 'Error');
        }
        return {} as any;
      });

      const digest = await generateContextDigest('testproject', 'review-agent');
      expect(digest).toBeNull();
    });

    it('should return null if empty digest generated', async () => {
      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, '   \n  ', '');
        }
        return {} as any;
      });

      const digest = await generateContextDigest('testproject', 'review-agent');
      expect(digest).toBeNull();
    });

    it('should create context directory if it does not exist', async () => {
      const contextDir = getContextDirectory('testproject', 'review-agent');
      expect(existsSync(contextDir)).toBe(false);

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, 'digest', '');
        }
        return {} as any;
      });

      await generateContextDigest('testproject', 'review-agent');

      expect(existsSync(contextDir)).toBe(true);
    });

    it('should log stderr warnings but continue', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, 'digest', 'some error output');
        }
        return {} as any;
      });

      const digest = await generateContextDigest('testproject', 'review-agent');
      expect(digest).toBe('digest');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[claude-invoke] STDERR purpose=specialist-digest')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should not log stderr if it contains only warnings', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, 'digest', 'warning: something');
        }
        return {} as any;
      });

      const digest = await generateContextDigest('testproject', 'review-agent');
      expect(digest).toBe('digest');
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('regenerateContextDigest', () => {
    it('should call generateContextDigest with force option', async () => {
      vi.spyOn(specialistLogs, 'getRecentRunLogs').mockReturnValue([]);

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(null, 'regenerated digest', '');
        }
        return {} as any;
      });

      const digest = await regenerateContextDigest('testproject', 'review-agent');
      expect(digest).toBe('regenerated digest');
    });
  });

  describe('scheduleDigestGeneration', () => {
    it('should trigger digest generation asynchronously', async () => {
      vi.spyOn(specialistLogs, 'getRecentRunLogs').mockReturnValue([
        {
          runId: '2024-01-01T12-00-00-TEST-1',
          filePath: join(testDir, 'run1.log'),
          metadata: {
            runId: '2024-01-01T12-00-00-TEST-1',
            project: 'testproject',
            specialistType: 'review-agent',
            issueId: 'TEST-1',
            startedAt: '2024-01-01T12:00:00Z',
            status: 'passed',
          },
          fileSize: 1024,
          createdAt: new Date(),
        },
      ]);

      const mockExec = vi.mocked(childProcess.exec);
      let execCalled = false;
      mockExec.mockImplementation((cmd, options, callback) => {
        execCalled = true;
        if (callback) {
          callback(null, 'scheduled digest', '');
        }
        return {} as any;
      });

      // Should not throw
      scheduleDigestGeneration('testproject', 'review-agent');

      // Give it a moment to execute
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(execCalled).toBe(true);
    });

    it('should catch and log errors without throwing', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(specialistLogs, 'getRecentRunLogs').mockReturnValue([
        {
          runId: '2024-01-01T12-00-00-TEST-1',
          filePath: join(testDir, 'run1.log'),
          metadata: {
            runId: '2024-01-01T12-00-00-TEST-1',
            project: 'testproject',
            specialistType: 'review-agent',
            issueId: 'TEST-1',
            startedAt: '2024-01-01T12:00:00Z',
            status: 'passed',
          },
          fileSize: 1024,
          createdAt: new Date(),
        },
      ]);

      const mockExec = vi.mocked(childProcess.exec);
      mockExec.mockImplementation((cmd, options, callback) => {
        if (callback) {
          callback(new Error('Scheduled generation failed'), '', '');
        }
        return {} as any;
      });

      // Should not throw
      scheduleDigestGeneration('testproject', 'review-agent');

      // Give it a moment to execute and catch error
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[claude-invoke] FAILED purpose=specialist-digest')
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
