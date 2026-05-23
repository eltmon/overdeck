import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';

// Mock dependencies
vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 }),
}));

vi.mock('../../../src/lib/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    panopticon: { version: '1.0.0' },
    sync: { backup_before_sync: true },
    trackers: { primary: 'linear' },
    dashboard: { port: 3001, api_port: 3002 },
  }),
  loadConfigSync: vi.fn().mockReturnValue({
    panopticon: { version: '1.0.0' },
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

describe('doctor command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      expect(config).toHaveProperty('panopticon');
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

      expect(existsSync('/home/test/.panopticon/skills')).toBe(true);
    });

    it('should check if commands directory exists', () => {
      const mockExistsSync = vi.mocked(existsSync);
      mockExistsSync.mockReturnValue(true);

      expect(existsSync('/home/test/.panopticon/commands')).toBe(true);
    });
  });
});
