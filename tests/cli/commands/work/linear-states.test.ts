/**
 * Tests for Linear states CLI commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(function () { return {
    teams: vi.fn().mockResolvedValue({
      nodes: [
        {
          states: vi.fn().mockResolvedValue({
            nodes: [
              { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 0 },
              { id: 'state-review', name: 'CustomState', type: 'custom', position: 1 },
            ],
          }),
        },
      ],
    }),
    issues: vi.fn().mockResolvedValue({ nodes: [] }),
  }; }),
}));

describe('linear-states', () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalApiKey: string | undefined;
  let mockExit: any;
  let mockError: any;
  let mockLog: any;

  beforeEach(async () => {
    tempDir = join(tmpdir(), 'pan-linear-test-' + Date.now());
    mkdirSync(tempDir, { recursive: true });

    originalHome = process.env.HOME;
    originalApiKey = process.env.LINEAR_API_KEY;

    // Mock console methods
    mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock process.exit
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    // Clear module cache
    vi.resetModules();
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (originalApiKey) {
      process.env.LINEAR_API_KEY = originalApiKey;
    } else {
      delete process.env.LINEAR_API_KEY;
    }

    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('API key retrieval', () => {
    it('should read API key from environment variable', async () => {
      process.env.LINEAR_API_KEY = 'env-api-key';
      process.env.HOME = tempDir;

      // Should be able to import without error about missing API key
      const mod = await import('../../../../src/cli/commands/admin/tracker-handler.js');
      expect(mod).toBeDefined();
      expect(mod.listStatesCommand).toBeDefined();
      expect(mod.cleanupStatesCommand).toBeDefined();
    });

    it('should read API key from ~/.panopticon.env file', async () => {
      delete process.env.LINEAR_API_KEY;
      process.env.HOME = tempDir;
      writeFileSync(join(tempDir, '.panopticon.env'), 'LINEAR_API_KEY=file-api-key\n');

      const mod = await import('../../../../src/cli/commands/admin/tracker-handler.js');
      expect(mod).toBeDefined();
      expect(mod.listStatesCommand).toBeDefined();
    });

  });

  describe('cleanupStatesCommand', () => {
    it('should show dry run message when --dry-run flag is used', async () => {
      process.env.LINEAR_API_KEY = 'test-key';
      process.env.HOME = tempDir;

      const { cleanupStatesCommand } = await import('../../../../src/cli/commands/admin/tracker-handler.js');
      await cleanupStatesCommand({ team: 'TEST', state: 'Planning', dryRun: true });

      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Dry run mode'));
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('TEST'));
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Planning'));
    });

    it('should use default state name Planning when not specified', async () => {
      process.env.LINEAR_API_KEY = 'test-key';
      process.env.HOME = tempDir;

      const { cleanupStatesCommand } = await import('../../../../src/cli/commands/admin/tracker-handler.js');

      // This will fail with fake API key
      try {
        await cleanupStatesCommand({ team: 'TEST' });
      } catch {
        // Expected
      }

      // Should indicate it's trying to archive 'Planning' by default
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Archiving state "Planning"'));
    });

    it('should accept custom state name', async () => {
      process.env.LINEAR_API_KEY = 'test-key';
      process.env.HOME = tempDir;

      const { cleanupStatesCommand } = await import('../../../../src/cli/commands/admin/tracker-handler.js');

      try {
        await cleanupStatesCommand({ team: 'TEST', state: 'CustomState' });
      } catch {
        // Expected to fail with fake API
      }

      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Archiving state "CustomState"'));
    });
  });
});
