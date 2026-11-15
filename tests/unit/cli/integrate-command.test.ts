import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAN_NOT_INSTALLED, runIntegrateFileManager, type IntegrateDeps } from '../../../src/cli/commands/integrate.js';
import { readFileManagerState, removeFileManagerState, writeFileManagerState } from '../../../src/lib/integrations/file-manager.js';

let home: string;
let logs: string[];

function makeDeps(overrides: Partial<IntegrateDeps> = {}): IntegrateDeps & { apply: ReturnType<typeof vi.fn>; installIcon: ReturnType<typeof vi.fn> } {
  return {
    platform: 'linux',
    home,
    overdeckHome: join(home, '.overdeck'),
    resolvePanPath: () => '/od/cli-bin/pan',
    installIcon: vi.fn(async () => join(home, '.overdeck', 'integrations', 'overdeck.svg')),
    apply: vi.fn(async () => {}),
    readState: readFileManagerState,
    writeState: writeFileManagerState,
    removeState: removeFileManagerState,
    now: () => new Date('2026-11-15T12:00:00Z'),
    log: (line) => logs.push(line),
    ...overrides,
  } as IntegrateDeps & { apply: ReturnType<typeof vi.fn>; installIcon: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'integrate-'));
  logs = [];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('pan integrate file-manager', () => {
  it('with --dry-run prints every planned path and applies nothing', async () => {
    const deps = makeDeps();
    expect(await runIntegrateFileManager({ dryRun: true }, deps)).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain(join(home, '.local/share/applications/overdeck-open.desktop'));
    expect(out).toContain(join(home, '.local/share/nautilus/scripts/Open in Overdeck'));
    expect(out).toContain(join(home, '.local/share/kio/servicemenus/overdeck-open.desktop'));
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.installIcon).not.toHaveBeenCalled();
    expect(await readFileManagerState(deps.overdeckHome)).toBeNull();
  });

  it('records the install in the state file', async () => {
    const deps = makeDeps();
    expect(await runIntegrateFileManager({}, deps)).toBe(0);
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(await readFileManagerState(deps.overdeckHome)).toEqual({
      installed: true,
      platform: 'linux',
      panPath: '/od/cli-bin/pan',
      at: '2026-11-15T12:00:00.000Z',
      files: [
        join(home, '.local/share/applications/overdeck-open.desktop'),
        join(home, '.local/share/nautilus/scripts/Open in Overdeck'),
        join(home, '.local/share/kio/servicemenus/overdeck-open.desktop'),
      ],
      registryKeys: [],
    });
  });

  it('removes the recorded entries and the state file', async () => {
    const deps = makeDeps();
    await runIntegrateFileManager({}, deps);
    deps.apply.mockClear();
    expect(await runIntegrateFileManager({ remove: true }, deps)).toBe(0);
    expect(deps.apply.mock.calls[0]?.[0]).toMatchObject({ deletes: expect.arrayContaining([join(home, '.local/share/nautilus/scripts/Open in Overdeck')]) });
    expect(await readFileManagerState(deps.overdeckHome)).toBeNull();
  });

  it('with --remove and no state prints Nothing to remove and exits 0', async () => {
    const deps = makeDeps();
    expect(await runIntegrateFileManager({ remove: true }, deps)).toBe(0);
    expect(logs).toEqual(['Nothing to remove']);
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it('exits 1 when pan cannot be found', async () => {
    const errors: string[] = [];
    const deps = makeDeps({ resolvePanPath: () => null });
    expect(await runIntegrateFileManager({}, deps, (line) => errors.push(line))).toBe(1);
    expect(errors).toEqual([PAN_NOT_INSTALLED]);
    expect(deps.apply).not.toHaveBeenCalled();
  });
});
