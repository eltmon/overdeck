import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import type { EditorId } from '@panctl/contracts';

// ─── Mock child_process ──────────────────────────────────────────────────────

const mockSpawn = vi.fn((..._args: unknown[]) => ({ unref: vi.fn() }));
const mockExecAsync = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: () => mockExecAsync,
}));

describe('PanOpen service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('resolveAvailableEditors', () => {
    it('detects editors available on PATH', async () => {
      mockExecAsync.mockImplementation(async (cmd: string) => {
        if (cmd.includes('cursor')) return { stdout: '/usr/bin/cursor' };
        if (cmd.includes('code') && !cmd.includes('codium') && !cmd.includes('insiders')) return { stdout: '/usr/bin/code' };
        if (cmd.includes('xdg-open')) return { stdout: '/usr/bin/xdg-open' };
        throw new Error('not found');
      });

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.getAvailableEditors();
      }).pipe(Effect.provide(PanOpenLive))));

      const editors = await Effect.runPromise(program);
      expect(editors).toContain('cursor');
      expect(editors).toContain('vscode');
      expect(editors).toContain('file-manager');
      expect(editors).not.toContain('zed');
    });

    it('returns empty array when no editors found', async () => {
      mockExecAsync.mockRejectedValue(new Error('not found'));

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.getAvailableEditors();
      }).pipe(Effect.provide(PanOpenLive))));

      const editors = await Effect.runPromise(program);
      expect(editors).toEqual([]);
    });
  });

  describe('openInEditor', () => {
    it('launches editor as detached process', async () => {
      mockExecAsync.mockRejectedValue(new Error('not found'));

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.openInEditor({ cwd: '/tmp/workspace', editor: 'cursor' });
      }).pipe(Effect.provide(PanOpenLive))));

      await Effect.runPromise(program);

      expect(mockSpawn).toHaveBeenCalledWith(
        'cursor',
        ['/tmp/workspace'],
        { detached: true, stdio: 'ignore' },
      );
    });

    it('launches file manager with platform command', async () => {
      mockExecAsync.mockRejectedValue(new Error('not found'));

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.openInEditor({ cwd: '/tmp/workspace', editor: 'file-manager' });
      }).pipe(Effect.provide(PanOpenLive))));

      await Effect.runPromise(program);

      const platformCmd = process.platform === 'linux' ? 'xdg-open' :
        process.platform === 'darwin' ? 'open' : 'explorer';
      expect(mockSpawn).toHaveBeenCalledWith(
        platformCmd,
        ['/tmp/workspace'],
        { detached: true, stdio: 'ignore' },
      );
    });

    it('returns error for unsupported editor', async () => {
      mockExecAsync.mockRejectedValue(new Error('not found'));

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = (await Effect.runPromise(Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.openInEditor({ cwd: '/tmp/workspace', editor: 'nonexistent' as EditorId });
      }).pipe(Effect.provide(PanOpenLive))));

      const exit = await Effect.runPromise(Effect.exit(program));
      expect(exit._tag).toBe('Failure');
    });
  });
});
