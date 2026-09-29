/**
 * `pan vault setup --hooks` (PAN-2609, P-15): register one Claude Code Stop
 * hook that runs `pan vault save --hook`, idempotently, in ~/.claude/settings.json.
 * Refuses to touch a settings file that is not valid JSON.
 */
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { addHookCommandIfMissing, type ClaudeSettings } from '../../../lib/claude-hooks-registration.js';
import type { CliIo } from './shared.js';

export function claudeSettingsPath(home = homedir()): string {
  return join(home, '.claude', 'settings.json');
}

/** The hook command: absolute node + absolute CLI entry, so it works without `pan` on PATH. */
export function vaultHookCommand(execPath = process.execPath, script = process.argv[1] ?? ''): string {
  let resolved = script;
  try {
    resolved = realpathSync(script);
  } catch {
    // keep the given path when it cannot be resolved (tests, unusual launchers)
  }
  return `${JSON.stringify(execPath)} ${JSON.stringify(resolved)} vault save --hook`;
}

export async function installVaultStopHook(io: CliIo, settingsPath = claudeSettingsPath(), command = vaultHookCommand()): Promise<boolean> {
  let raw = '';
  try {
    raw = await readFile(settingsPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let settings: ClaudeSettings = {};
  if (raw.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      settings = parsed as ClaudeSettings;
    } catch (error) {
      io.err(`${settingsPath} is not valid JSON (${(error as Error).message}); nothing was written. Fix the file and run pan vault setup --hooks again.`);
      return false;
    }
  }
  const added = addHookCommandIfMissing(settings, 'Stop', command);
  if (!added) {
    io.out(`Stop hook already present in ${settingsPath}: ${command}`);
    return false;
  }
  await mkdir(dirname(settingsPath), { recursive: true });
  const temp = `${settingsPath}.${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`);
    await rename(temp, settingsPath);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  io.out(`Added Claude Code Stop hook to ${settingsPath}:`);
  io.out(`  ${JSON.stringify({ matcher: '.*', hooks: [{ type: 'command', command }] })}`);
  return true;
}
