import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  applyOverdeckHookRegistrations,
  HOOK_SCRIPT_NAMES,
  OVERDECK_HOOK_REGISTRATIONS,
  type ClaudeSettings,
} from '../claude-hooks-registration.js';
import { provisionClaudeHooks } from '../claude-hooks-provision.js';

// PAN-2595: desktop installs never run `pan install`; the boot provisioner
// copies hook binaries and delta-registers them in ~/.claude/settings.json.

describe('applyOverdeckHookRegistrations', () => {
  const binDir = '/home/user/.overdeck/bin';

  it('registers every table entry into empty settings (python3 available)', () => {
    const settings: ClaudeSettings = {};
    const { added, removed } = applyOverdeckHookRegistrations(settings, binDir, { python3Available: true });

    expect(removed).toEqual([]);
    expect(added).toHaveLength(OVERDECK_HOOK_REGISTRATIONS.length);
    expect(settings.hooks?.PreToolUse?.some((entry) =>
      entry.hooks.some((hook) => hook.command === join(binDir, 'auto-approve-hook')))).toBe(true);
    expect(settings.hooks?.PermissionRequest?.some((entry) =>
      entry.hooks.some((hook) => hook.command === join(binDir, 'permission-event-hook')))).toBe(true);
  });

  it('skips TLDR hooks without python3 and is idempotent', () => {
    const settings: ClaudeSettings = {};
    const first = applyOverdeckHookRegistrations(settings, binDir, { python3Available: false });
    expect(first.added.some((entry) => entry.includes('tldr'))).toBe(false);

    const second = applyOverdeckHookRegistrations(settings, binDir, { python3Available: false });
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  it('preserves user customizations and unknown top-level keys', () => {
    const settings: ClaudeSettings = {
      statusLine: { type: 'command', command: 'my-statusline' },
      hooks: {
        PreToolUse: [
          { matcher: 'MyTool', hooks: [{ type: 'command', command: '/custom/hook' }] },
        ],
      },
    };
    applyOverdeckHookRegistrations(settings, binDir, { python3Available: true });

    expect(settings.statusLine).toEqual({ type: 'command', command: 'my-statusline' });
    expect(settings.hooks?.PreToolUse?.[0]).toEqual(
      { matcher: 'MyTool', hooks: [{ type: 'command', command: '/custom/hook' }] },
    );
  });

  it('prunes stale panopticon/bin twins while registering', () => {
    const settings: ClaudeSettings = {
      hooks: {
        Stop: [
          { matcher: '.*', hooks: [{ type: 'command', command: '/home/user/.panopticon/bin/stop-hook' }] },
        ],
      },
    };
    const { added, removed } = applyOverdeckHookRegistrations(settings, binDir, { python3Available: false });

    expect(removed).toContain('Stop:stop-hook');
    expect(added).toContain('Stop:stop-hook');
    expect(settings.hooks?.Stop?.some((entry) =>
      entry.hooks.some((hook) => hook.command.includes('panopticon/bin')))).toBe(false);
  });
});

describe('provisionClaudeHooks', () => {
  let tmpRoot: string;
  let settingsPath: string;
  let binDir: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `hooks-prov-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    settingsPath = join(tmpRoot, '.claude', 'settings.json');
    binDir = join(tmpRoot, 'bin');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // This repo has real sync-sources/hooks and jq installed, so the provisioner
  // exercises its true happy path against injected settings/bin locations.
  it('copies all hook binaries and registers hooks into fresh settings', async () => {
    const result = await provisionClaudeHooks({ settingsPath, binDir });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.binariesSynced).toBe(HOOK_SCRIPT_NAMES.length);
    expect(readdirSync(binDir)).toEqual(expect.arrayContaining(['auto-approve-hook', 'pan-hook-lib.sh']));

    const written = JSON.parse(readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    expect(written.hooks?.PreToolUse?.some((entry) =>
      entry.hooks.some((hook) => hook.command === join(binDir, 'auto-approve-hook')))).toBe(true);
  });

  it('is a no-op on the second run (no write, no backup)', async () => {
    await provisionClaudeHooks({ settingsPath, binDir });
    const before = readFileSync(settingsPath, 'utf-8');

    const second = await provisionClaudeHooks({ settingsPath, binDir });

    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(readFileSync(settingsPath, 'utf-8')).toBe(before);
    // Fresh install: the first run had no pre-existing file to back up, and
    // the no-op second run must not create one either.
    const backups = readdirSync(join(tmpRoot, '.claude')).filter((name) => name.includes('.pan-backup-'));
    expect(backups).toHaveLength(0);
  });

  it('refuses to write over an unparseable settings.json (PAN-1137)', async () => {
    writeFileSync(settingsPath, '{ not json');

    const result = await provisionClaudeHooks({ settingsPath, binDir });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not valid JSON');
    expect(readFileSync(settingsPath, 'utf-8')).toBe('{ not json');
  });

  it('backs up an existing settings.json before writing', async () => {
    writeFileSync(settingsPath, JSON.stringify({ statusLine: { command: 'keep-me' } }));

    const result = await provisionClaudeHooks({ settingsPath, binDir });

    expect(result.ok).toBe(true);
    const backups = readdirSync(join(tmpRoot, '.claude')).filter((name) => name.includes('.pan-backup-'));
    expect(backups).toHaveLength(1);
    const written = JSON.parse(readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    expect(written.statusLine).toEqual({ command: 'keep-me' });
    expect(existsSync(join(binDir, 'record-cost-event.js'))).toBe(true);
  });
});
