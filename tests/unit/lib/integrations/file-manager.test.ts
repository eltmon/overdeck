import { mkdtempSync, readFileSync, rmSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFileManagerPlan,
  planFileManagerInstall,
  planFileManagerRemove,
  readFileManagerState,
  resolvePanPath,
  writeFileManagerState,
  type FileManagerState,
} from '../../../../src/lib/integrations/file-manager.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'fm-home-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const PAN = '/opt/pan/bin/pan';

describe('planFileManagerInstall on Linux', () => {
  it('writes the three entries with their modes, each running the quoted pan path', () => {
    const plan = planFileManagerInstall({ platform: 'linux', home, panPath: PAN, iconPath: '/i/overdeck.svg' });
    expect(plan.files.map((f) => [f.path, f.mode])).toEqual([
      [join(home, '.local/share/applications/overdeck-open.desktop'), 0o644],
      [join(home, '.local/share/nautilus/scripts/Open in Overdeck'), 0o755],
      [join(home, '.local/share/kio/servicemenus/overdeck-open.desktop'), 0o755],
    ]);
    const [openWith, nautilus, dolphin] = plan.files.map((f) => f.content);
    expect(openWith).toContain(`Exec="${PAN}" open %f`);
    expect(openWith).toContain('NoDisplay=true');
    expect(openWith).toContain('MimeType=inode/directory;text/plain;application/octet-stream;');
    expect(openWith).toContain('Icon=/i/overdeck.svg');
    expect(nautilus).toBe(`#!/bin/sh\nfor f in "$@"; do "${PAN}" open "$f"; done\n`);
    expect(dolphin).toContain('Type=Service');
    expect(dolphin).toContain('Actions=openInOverdeck;');
    expect(dolphin).toContain(`Exec="${PAN}" open %f`);
    expect(plan.commands).toEqual([{ cmd: 'update-desktop-database', args: [join(home, '.local/share/applications')], optional: true }]);
    expect(plan.registryKeys).toEqual([]);
  });

  it('keeps a pan path with a space as one double-quoted argument', () => {
    const spaced = '/home/a b/.overdeck/cli-bin/pan';
    const plan = planFileManagerInstall({ platform: 'linux', home, panPath: spaced });
    for (const file of plan.files) {
      const lines = file.content.split('\n').filter((line) => line.includes('open'));
      expect(lines.some((line) => line.includes(`"${spaced}" open`))).toBe(true);
    }
    expect(plan.files[0]!.content).not.toContain('Icon=');
  });
});

describe('planFileManagerInstall on macOS', () => {
  it('writes the Quick Action bundle and refreshes services if pbs exists', () => {
    const plan = planFileManagerInstall({ platform: 'darwin', home, panPath: PAN });
    const bundle = join(home, 'Library/Services/Open in Overdeck.workflow/Contents');
    expect(plan.files.map((f) => f.path)).toEqual([join(bundle, 'Info.plist'), join(bundle, 'document.wflow')]);
    const [plist, wflow] = plan.files.map((f) => f.content);
    expect(plist).toContain('<key>NSServices</key>');
    expect(plist).toContain('<string>runWorkflowAsService</string>');
    expect(plist).toContain('<string>public.item</string>');
    expect(plist).toContain('<string>com.apple.finder</string>');
    expect(wflow).toContain('<string>/bin/zsh</string>');
    expect(wflow).toContain(`for f in "$@"; do "${PAN}" open "$f"; done`);
    expect(plan.commands).toEqual([{ cmd: '/System/Library/CoreServices/pbs', args: ['-update'], optional: true }]);
  });

  it('escapes XML characters in the script body', () => {
    const plan = planFileManagerInstall({ platform: 'darwin', home, panPath: '/a&b/pan' });
    expect(plan.files[1]!.content).toContain('"/a&amp;b/pan" open');
  });
});

describe('planFileManagerInstall on Windows', () => {
  it('adds three keys, the background one passing %V', () => {
    const panPath = 'C:\\Users\\a b\\pan.cmd';
    const plan = planFileManagerInstall({ platform: 'win32', home, panPath });
    expect(plan.files).toEqual([]);
    expect(plan.registryKeys).toEqual([
      'HKCU\\Software\\Classes\\*\\shell\\OpenInOverdeck',
      'HKCU\\Software\\Classes\\Directory\\shell\\OpenInOverdeck',
      'HKCU\\Software\\Classes\\Directory\\Background\\shell\\OpenInOverdeck',
    ]);
    const commandArgs = plan.commands.filter((c) => c.args[1]!.endsWith('\\command')).map((c) => c.args);
    expect(commandArgs).toEqual([
      ['add', 'HKCU\\Software\\Classes\\*\\shell\\OpenInOverdeck\\command', '/ve', '/d', `"${panPath}" open "%1"`, '/f'],
      ['add', 'HKCU\\Software\\Classes\\Directory\\shell\\OpenInOverdeck\\command', '/ve', '/d', `"${panPath}" open "%1"`, '/f'],
      ['add', 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\OpenInOverdeck\\command', '/ve', '/d', `"${panPath}" open "%V"`, '/f'],
    ]);
    expect(plan.commands.filter((c) => c.args.includes('Open in Overdeck'))).toHaveLength(3);
    expect(plan.commands.every((c) => c.cmd === 'reg' && !c.optional)).toBe(true);
  });
});

describe('planFileManagerRemove', () => {
  it('deletes exactly the recorded files and registry keys', () => {
    const state: FileManagerState = {
      installed: true,
      platform: 'win32',
      panPath: 'C:\\pan.cmd',
      at: '2026-11-15T00:00:00Z',
      files: [],
      registryKeys: ['HKCU\\Software\\Classes\\*\\shell\\OpenInOverdeck'],
    };
    const plan = planFileManagerRemove(state);
    expect(plan.deletes).toEqual([]);
    expect(plan.commands).toEqual([{ cmd: 'reg', args: ['delete', 'HKCU\\Software\\Classes\\*\\shell\\OpenInOverdeck', '/f'], optional: true }]);

    const linux = planFileManagerRemove({ ...state, platform: 'linux', registryKeys: [], files: ['/h/.local/share/applications/overdeck-open.desktop', '/h/x'] });
    expect(linux.deletes).toEqual(['/h/.local/share/applications/overdeck-open.desktop', '/h/x']);
    expect(linux.commands).toEqual([{ cmd: 'update-desktop-database', args: ['/h/.local/share/applications'], optional: true }]);

    const mac = planFileManagerRemove({ ...state, platform: 'darwin', registryKeys: [], files: ['/h/S/O.workflow/Contents/Info.plist'] });
    expect(mac.pruneDirs).toEqual(['/h/S/O.workflow/Contents', '/h/S/O.workflow']);
  });
});

describe('applyFileManagerPlan', () => {
  it('writes files with their modes and removes them again, skipping a missing optional command', async () => {
    const notes: string[] = [];
    const plan = planFileManagerInstall({ platform: 'linux', home, panPath: PAN });
    const execFile = vi.fn(async () => {
      throw Object.assign(new Error('spawn update-desktop-database ENOENT'), { code: 'ENOENT' });
    });
    await applyFileManagerPlan(plan, { execFile, note: (line) => notes.push(line) });
    const script = join(home, '.local/share/nautilus/scripts/Open in Overdeck');
    expect(readFileSync(script, 'utf8')).toContain(`"${PAN}" open`);
    expect(statSync(script).mode & 0o777).toBe(0o755);
    expect(notes).toEqual(['Skipped update-desktop-database: not installed']);

    const state: FileManagerState = { installed: true, platform: 'linux', panPath: PAN, at: '', files: plan.files.map((f) => f.path), registryKeys: [] };
    await applyFileManagerPlan(planFileManagerRemove(state), { execFile: vi.fn(async () => undefined) });
    expect(plan.files.every((f) => !existsSync(f.path))).toBe(true);
  });

  it('throws when a required command fails', async () => {
    const plan = planFileManagerInstall({ platform: 'win32', home, panPath: 'C:\\pan.cmd' });
    await expect(applyFileManagerPlan(plan, { execFile: vi.fn(async () => { throw new Error('Access is denied'); }) })).rejects.toThrow('Access is denied');
  });
});

describe('state file', () => {
  it('round-trips and reads a missing or broken file as null', async () => {
    const overdeckHome = join(home, '.overdeck');
    expect(await readFileManagerState(overdeckHome)).toBeNull();
    const state: FileManagerState = { installed: true, platform: 'linux', panPath: PAN, at: '2026-11-15T00:00:00Z', files: ['/a'], registryKeys: [] };
    await writeFileManagerState(state, overdeckHome);
    expect(await readFileManagerState(overdeckHome)).toEqual(state);
    writeFileSync(join(overdeckHome, 'integrations', 'file-manager.json'), '{broken');
    expect(await readFileManagerState(overdeckHome)).toBeNull();
  });
});

describe('resolvePanPath', () => {
  it('prefers an executable shim, then pan on PATH', () => {
    const shimPath = '/od/cli-bin/pan';
    expect(resolvePanPath('linux', { shimPath, pathEnv: '/usr/bin', isExecutable: (p) => p === shimPath || p === '/usr/bin/pan' })).toBe(shimPath);
    expect(resolvePanPath('linux', { shimPath, pathEnv: '/a:/usr/bin', isExecutable: (p) => p === '/usr/bin/pan' })).toBe('/usr/bin/pan');
    expect(resolvePanPath('darwin', { shimPath, pathEnv: '/a', isExecutable: () => false })).toBeNull();
  });

  it('finds pan.cmd or pan.exe on a Windows PATH', () => {
    expect(resolvePanPath('win32', { pathEnv: 'C:\\a;C:\\npm', isExecutable: (p) => p === 'C:\\npm\\pan.cmd' })).toBe('C:\\npm\\pan.cmd');
    expect(resolvePanPath('win32', { pathEnv: 'C:\\b', isExecutable: (p) => p === 'C:\\b\\pan.exe' })).toBe('C:\\b\\pan.exe');
  });

  it('treats a real executable file as the shim', () => {
    const dir = join(home, 'cli-bin');
    mkdirSync(dir);
    writeFileSync(join(dir, 'pan'), '#!/bin/sh\n', { mode: 0o755 });
    expect(resolvePanPath('linux', { shimPath: join(dir, 'pan'), pathEnv: '' })).toBe(join(dir, 'pan'));
  });
});
