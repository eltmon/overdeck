import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import type { EditorId } from '@overdeck/contracts';

// ─── Mock child_process ──────────────────────────────────────────────────────

const mockSpawn = vi.fn((..._args: unknown[]) => ({ unref: vi.fn() }));
const mockExecAsync = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  exec: vi.fn(),
  execFile: vi.fn(),
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

      const program = Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.getAvailableEditors();
      }).pipe(Effect.provide(PanOpenLive));

      const editors = await Effect.runPromise(program);
      expect(editors).toContain('cursor');
      expect(editors).toContain('vscode');
      expect(editors).toContain('file-manager');
      expect(editors).not.toContain('zed');
    });

    it('detects Kiro without JetBrains editors', async () => {
      mockExecAsync.mockImplementation(async (cmd: string) => {
        if (cmd === 'which kiro') return { stdout: '/usr/bin/kiro' };
        throw new Error('not found');
      });

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.getAvailableEditors();
      }).pipe(Effect.provide(PanOpenLive));

      const editors = await Effect.runPromise(program);
      expect(editors).toContain('kiro');
      expect(editors).not.toContain('idea');
      expect(editors).not.toContain('pycharm');
      expect(editors).not.toContain('webstorm');
    });

    it('detects the full JetBrains editor family', async () => {
      const jetBrainsCommands = new Set([
        'idea',
        'aqua',
        'clion',
        'datagrip',
        'dataspell',
        'goland',
        'phpstorm',
        'pycharm',
        'rider',
        'rubymine',
        'rustrover',
        'webstorm',
      ]);

      mockExecAsync.mockImplementation(async (cmd: string) => {
        const command = cmd.split(' ').at(-1);
        if (command && jetBrainsCommands.has(command)) return { stdout: `/usr/bin/${command}` };
        throw new Error('not found');
      });

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.getAvailableEditors();
      }).pipe(Effect.provide(PanOpenLive));

      const editors = await Effect.runPromise(program);
      expect(editors).toEqual(expect.arrayContaining([
        'idea',
        'aqua',
        'clion',
        'datagrip',
        'dataspell',
        'goland',
        'phpstorm',
        'pycharm',
        'rider',
        'rubymine',
        'rustrover',
        'webstorm',
      ]));
      expect(editors).not.toContain('kiro');
    });

    it('returns empty array when no editors found', async () => {
      mockExecAsync.mockRejectedValue(new Error('not found'));

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.getAvailableEditors();
      }).pipe(Effect.provide(PanOpenLive));

      const editors = await Effect.runPromise(program);
      expect(editors).toEqual([]);
    });
  });

  describe('openInEditor', () => {
    it('launches editor as detached process', async () => {
      mockExecAsync.mockRejectedValue(new Error('not found'));

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.openInEditor({ cwd: '/tmp/workspace', editor: 'cursor' });
      }).pipe(Effect.provide(PanOpenLive));

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

      const program = Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.openInEditor({ cwd: '/tmp/workspace', editor: 'file-manager' });
      }).pipe(Effect.provide(PanOpenLive));

      await Effect.runPromise(program);

      const platformCmd = process.platform === 'linux' ? 'xdg-open' :
        process.platform === 'darwin' ? 'open' : 'explorer';
      expect(mockSpawn).toHaveBeenCalledWith(
        platformCmd,
        ['/tmp/workspace'],
        { detached: true, stdio: 'ignore' },
      );
    });

    describe('reveal', () => {
      const originalPlatform = process.platform;
      const setPlatform = (platform: NodeJS.Platform) => {
        Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      };

      afterEach(() => {
        setPlatform(originalPlatform);
      });

      // Every `which`/`where` lookup succeeds, so the platform opener is
      // detected; the D-Bus call (Linux only) succeeds or fails as asked.
      function mockOpenerAvailable({ dbusOk }: { dbusOk: boolean }) {
        mockExecAsync.mockImplementation(async (cmd: string) => {
          if (cmd === 'dbus-send' && !dbusOk) throw new Error('no FileManager1');
          return { stdout: '' };
        });
      }

      async function reveal(path: string) {
        const { PanOpen, PanOpenLive } = await import('../open.js');
        const program = Effect.gen(function* () {
          const svc = yield* PanOpen;
          return yield* svc.openInEditor({ cwd: path, editor: 'file-manager', reveal: true });
        }).pipe(Effect.provide(PanOpenLive));
        return Effect.runPromise(Effect.exit(program));
      }

      it('selects the file through the FileManager1 D-Bus interface on Linux', async () => {
        setPlatform('linux');
        mockOpenerAvailable({ dbusOk: true });

        await reveal('/tmp/a,b/My File.md');

        expect(mockExecAsync).toHaveBeenCalledWith('dbus-send', expect.arrayContaining([
          'org.freedesktop.FileManager1.ShowItems',
          'array:string:file:///tmp/a%2Cb/My%20File.md',
          'string:',
        ]), expect.anything());
        expect(mockSpawn).not.toHaveBeenCalled();
      });

      it('opens the parent folder on Linux when the D-Bus call fails', async () => {
        setPlatform('linux');
        mockOpenerAvailable({ dbusOk: false });

        await reveal('/tmp/workspace/notes.md');

        expect(mockSpawn).toHaveBeenCalledWith('xdg-open', ['/tmp/workspace'], { detached: true, stdio: 'ignore' });
      });

      it('fails without spawning when no file manager command was detected', async () => {
        setPlatform('linux');
        mockExecAsync.mockRejectedValue(new Error('not found'));

        const exit = await reveal('/tmp/workspace/notes.md');

        expect(exit._tag).toBe('Failure');
        expect(mockSpawn).not.toHaveBeenCalled();
      });

      it('uses open -R on macOS', async () => {
        setPlatform('darwin');
        mockOpenerAvailable({ dbusOk: false });

        await reveal('/tmp/workspace/notes.md');

        expect(mockSpawn).toHaveBeenCalledWith('open', ['-R', '/tmp/workspace/notes.md'], { detached: true, stdio: 'ignore' });
      });

      it('uses explorer /select on Windows', async () => {
        setPlatform('win32');
        mockOpenerAvailable({ dbusOk: false });

        await reveal('C:\\work\\notes.md');

        expect(mockSpawn).toHaveBeenCalledWith('explorer', ['/select,C:\\work\\notes.md'], { detached: true, stdio: 'ignore' });
      });
    });

    it('returns error for unsupported editor', async () => {
      mockExecAsync.mockRejectedValue(new Error('not found'));

      const { PanOpen, PanOpenLive } = await import('../open.js');

      const program = Effect.gen(function* () {
        const svc = yield* PanOpen;
        return yield* svc.openInEditor({ cwd: '/tmp/workspace', editor: 'nonexistent' as EditorId });
      }).pipe(Effect.provide(PanOpenLive));

      const exit = await Effect.runPromise(Effect.exit(program));
      expect(exit._tag).toBe('Failure');
    });
  });
});
