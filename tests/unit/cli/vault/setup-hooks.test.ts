import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installVaultStopHook, vaultHookCommand } from '../../../../src/cli/commands/vault/hooks.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { addHookCommandIfMissing, type ClaudeSettings } from '../../../../src/lib/claude-hooks-registration.js';
import { Fixture, captureIo, runCli } from './helpers.js';

describe('pan vault setup --hooks (P-15)', () => {
  let fx: Fixture;
  let home: string;

  beforeEach(() => {
    fx = new Fixture();
    ({ home } = fx.useMachine('a'));
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('builds the hook command from the absolute node and CLI paths', () => {
    expect(vaultHookCommand('/usr/bin/node', '/opt/pan/dist/cli/index.js')).toBe('"/usr/bin/node" "/opt/pan/dist/cli/index.js" vault save --hook');
  });

  it('addHookCommandIfMissing is idempotent and keeps other hooks', () => {
    const settings: ClaudeSettings = { hooks: { Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'other' }] }] }, theme: 'dark' };
    expect(addHookCommandIfMissing(settings, 'Stop', 'node pan vault save --hook')).toBe(true);
    expect(addHookCommandIfMissing(settings, 'Stop', 'node pan vault save --hook')).toBe(false);
    expect(settings.hooks!.Stop).toHaveLength(2);
    expect(settings.theme).toBe('dark');
  });

  it('ac1: running setup --hooks twice leaves exactly one Stop entry and preserves other hooks', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ theme: 'dark', hooks: { Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: '/x/other-hook.sh' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/x/pre.sh' }] }] } }, null, 2));
    const command = vaultHookCommand('/usr/bin/node', '/opt/pan/dist/cli/index.js');
    const first = captureIo();
    expect(await installVaultStopHook(first, settingsPath, command)).toBe(true);
    expect(first.stdout[0]).toContain(settingsPath);
    expect(first.stdout[1]).toContain('vault save --hook');
    const second = captureIo();
    expect(await installVaultStopHook(second, settingsPath, command)).toBe(false);
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
    const stopCommands = settings.hooks!.Stop!.flatMap((entry) => entry.hooks.map((hook) => hook.command));
    expect(stopCommands.filter((entry) => entry.endsWith('vault save --hook'))).toHaveLength(1);
    expect(stopCommands).toContain('/x/other-hook.sh');
    expect(settings.hooks!.PreToolUse).toHaveLength(1);
    expect(settings.theme).toBe('dark');

    // Through the verb itself, against the fixture HOME.
    const remote = fx.bareRepo();
    const io = captureIo();
    expect(await runCli(() => setupCommand(remote, { hooks: true }, io))).toBe(0);
    expect(await runCli(() => setupCommand(remote, { hooks: true }, captureIo()))).toBe(0);
    const after = JSON.parse(readFileSync(settingsPath, 'utf8')) as ClaudeSettings;
    const realCommand = vaultHookCommand();
    const commands = after.hooks!.Stop!.flatMap((entry) => entry.hooks.map((hook) => hook.command));
    expect(commands.filter((entry) => entry === realCommand)).toHaveLength(1);
    expect(commands).toContain('/x/other-hook.sh');
  });

  it('ac2: invalid JSON is refused and the file bytes are unchanged', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(settingsPath, '{ "hooks": ');
    const before = readFileSync(settingsPath);
    const io = captureIo();
    expect(await installVaultStopHook(io, settingsPath, 'cmd')).toBe(false);
    expect(io.stderr[0]).toContain('not valid JSON');
    expect(readFileSync(settingsPath).equals(before)).toBe(true);
  });

  it('ac3: setup without --hooks never creates or modifies ~/.claude/settings.json', async () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    const remote = fx.bareRepo();
    expect(await runCli(() => setupCommand(remote, {}, captureIo()))).toBe(0);
    expect(existsSync(settingsPath)).toBe(false);
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(settingsPath, '{"theme":"light"}\n');
    const before = readFileSync(settingsPath);
    expect(await runCli(() => setupCommand(remote, {}, captureIo()))).toBe(0);
    expect(readFileSync(settingsPath).equals(before)).toBe(true);
  });
});
