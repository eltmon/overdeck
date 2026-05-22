import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Must be called before importing the module under test.
// getCavemanHooksDir is imported by workspace.ts and needs to be mocked.
vi.mock('../setup.js', () => ({
  getCavemanHooksDir: vi.fn(),
}));

import { getCavemanHooksDir } from '../setup.js';
import {
  determineCavemanVariant,
  injectCavemanSettings,
  injectMemoryHookSettings,
  readCavemanVariant,
  type CavemanVariant,
} from '../workspace.js';

const mockGetHooksDir = vi.mocked(getCavemanHooksDir);

let testBase: string;
let workspaceDir: string;
let hooksDir: string;
let originalPanopticonHome: string | undefined;

beforeEach(() => {
  testBase = join(tmpdir(), `caveman-ws-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspaceDir = join(testBase, 'workspace');
  hooksDir = join(testBase, 'hooks');
  originalPanopticonHome = process.env.PANOPTICON_HOME;
  process.env.PANOPTICON_HOME = join(testBase, 'pan-home');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });
  mockGetHooksDir.mockReturnValue(hooksDir);
});

afterEach(() => {
  if (originalPanopticonHome === undefined) delete process.env.PANOPTICON_HOME;
  else process.env.PANOPTICON_HOME = originalPanopticonHome;
  rmSync(testBase, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── determineCavemanVariant ──────────────────────────────────────────────────

describe('determineCavemanVariant', () => {
  const baseModes = { work: 'full' as const, review: 'review' as const, test: 'lite' as const, merge: 'lite' as const };

  it('returns off when config.enabled is false', () => {
    expect(determineCavemanVariant({ enabled: false, abTest: false, modes: baseModes })).toBe('off');
  });

  it('returns enabled when enabled=true and abTest=false', () => {
    expect(determineCavemanVariant({ enabled: true, abTest: false, modes: baseModes })).toBe('enabled');
  });

  it('returns enabled when Math.random < 0.5 in ab_test mode', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    expect(determineCavemanVariant({ enabled: true, abTest: true, modes: baseModes })).toBe('enabled');
  });

  it('returns disabled when Math.random >= 0.5 in ab_test mode', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.7);
    expect(determineCavemanVariant({ enabled: true, abTest: true, modes: baseModes })).toBe('disabled');
  });
});

// ─── readCavemanVariant ───────────────────────────────────────────────────────

describe('readCavemanVariant', () => {
  it('returns off when variant file does not exist', async () => {
    (await Effect.runPromise(expect(await readCavemanVariant(workspaceDir))))ant(workspaceDir))).toBe('off');
  });

  it.each<[CavemanVariant]>([['enabled'], ['disabled'], ['off']])(
    'returns %s when file contains "%s"',
    async (variant) => {
      mkdirSync(join(workspaceDir, '.claude'), { recursive: true });
      writeFileSync(join(workspaceDir, '.claude', '.caveman-variant'), variant);
      (await Effect.runPromise(expect(await readCavemanVariant(workspaceDir))))ant(workspaceDir))).toBe(variant);
    }
  );

  it('returns off for unrecognized content', async () => {
    mkdirSync(join(workspaceDir, '.claude'), { recursive: true });
    writeFileSync(join(workspaceDir, '.claude', '.caveman-variant'), 'garbage-value\n');
    (await Effect.runPromise(expect(await readCavemanVariant(workspaceDir))))ant(workspaceDir))).toBe('off');
  });
});

describe('injectMemoryHookSettings', () => {
  it('installs Stop, SessionStart, and UserPromptSubmit memory hooks into fresh settings', async () => {
    await injectMemoryHookSettings(workspaceDir);

    const settings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.Stop[0].hooks[0]).toMatchObject({ type: 'command', timeout: 1 });
    expect(settings.hooks.Stop[0].hooks[0].command).toContain('panopticon-memory-hook.js" turn');
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('panopticon-memory-hook.js" session-start');
    expect(settings.hooks.UserPromptSubmit[0].hooks[0]).toMatchObject({ type: 'command', timeout: 2 });
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('panopticon-memory-hook.js" prompt-inject');

    const scriptPath = settings.hooks.Stop[0].hooks[0].command.match(/node "([^"]+)" turn/)?.[1];
    expect(scriptPath).toContain(join(process.env.PANOPTICON_HOME!, 'hooks', 'memory', 'panopticon-memory-hook.js'));
    expect(scriptPath).not.toContain(workspaceDir);
    const script = readFileSync(scriptPath, 'utf-8');
    expect(script).toContain('/api/memory/turn');
    expect(script).toContain('/api/memory/session/start');
    expect(script).toContain('/api/memory/inject');
  });

  it('preserves existing hooks and does not duplicate memory hooks on repeated setup', async () => {
    mkdirSync(join(workspaceDir, '.claude'), { recursive: true });
    writeFileSync(
      join(workspaceDir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'echo existing' }] }] } })
    );

    await injectMemoryHookSettings(workspaceDir);
    await injectMemoryHookSettings(workspaceDir);

    const settings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('echo existing');
    expect(settings.hooks.Stop[1].hooks[0].command).toContain('panopticon-memory-hook.js" turn');
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('reinstalls all memory hooks after workspace settings are recreated', async () => {
    await injectMemoryHookSettings(workspaceDir);
    rmSync(join(workspaceDir, '.claude'), { recursive: true, force: true });
    mkdirSync(workspaceDir, { recursive: true });

    await injectMemoryHookSettings(workspaceDir);

    const settings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    const scriptPath = settings.hooks.UserPromptSubmit[0].hooks[0].command.match(/node "([^"]+)" prompt-inject/)?.[1];
    expect(scriptPath).not.toContain(workspaceDir);
    expect(readFileSync(scriptPath, 'utf-8')).toContain('x-panopticon-internal-token');
  });
});

// ─── injectCavemanSettings ────────────────────────────────────────────────────

describe('injectCavemanSettings', () => {
  it('writes variant file "off" and leaves settings.json untouched', async () => {
    await Effect.runPromise(injectCavemanSettings(workspaceDir, 'off'));
    expect(readFileSync(join(workspaceDir, '.claude', '.caveman-variant'), 'utf-8')).toBe('off');
    expect(existsSync(join(workspaceDir, '.claude', 'settings.json'))).toBe(false);
  });

  it('writes variant=disabled and skips hook injection', async () => {
    await Effect.runPromise(injectCavemanSettings(workspaceDir, 'disabled'));
    expect(readFileSync(join(workspaceDir, '.claude', '.caveman-variant'), 'utf-8')).toBe('disabled');
    expect(existsSync(join(workspaceDir, '.claude', 'settings.json'))).toBe(false);
  });

  it('warns and skips injection when activate script is missing', async () => {
    // hooksDir exists but has no panopticon-caveman-activate.js
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await Effect.runPromise(injectCavemanSettings(workspaceDir, 'enabled'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pan admin hooks install'));
    expect(existsSync(join(workspaceDir, '.claude', 'settings.json'))).toBe(false);
  });

  it('injects SessionStart and UserPromptSubmit hooks into fresh settings.json', async () => {
    writeFileSync(join(hooksDir, 'panopticon-caveman-activate.js'), '// activate');
    writeFileSync(join(hooksDir, 'caveman-mode-tracker.js'), '// tracker');

    await Effect.runPromise(injectCavemanSettings(workspaceDir, 'enabled'));

    const settings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('panopticon-caveman-activate.js');
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('caveman-mode-tracker.js');
  });

  it('preserves existing hooks when deep-merging', async () => {
    writeFileSync(join(hooksDir, 'panopticon-caveman-activate.js'), '// activate');
    writeFileSync(join(hooksDir, 'caveman-mode-tracker.js'), '// tracker');

    mkdirSync(join(workspaceDir, '.claude'), { recursive: true });
    writeFileSync(
      join(workspaceDir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo existing', timeout: 5 }] }] } })
    );

    await Effect.runPromise(injectCavemanSettings(workspaceDir, 'enabled'));

    const settings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe('echo existing');
    expect(settings.hooks.SessionStart[1].hooks[0].command).toContain('panopticon-caveman-activate.js');
  });

  it('does not duplicate hooks on repeated calls (idempotent)', async () => {
    writeFileSync(join(hooksDir, 'panopticon-caveman-activate.js'), '// activate');
    writeFileSync(join(hooksDir, 'caveman-mode-tracker.js'), '// tracker');

    await Effect.runPromise(injectCavemanSettings(workspaceDir, 'enabled'));
    await Effect.runPromise(injectCavemanSettings(workspaceDir, 'enabled'));

    const settings = JSON.parse(readFileSync(join(workspaceDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });
});
