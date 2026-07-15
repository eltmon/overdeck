import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PAN-1223 desktop no-loss audit', () => {
  const updater = readFileSync(new URL('../src/updater.ts', import.meta.url), 'utf8');
  const menu = readFileSync(new URL('../src/menu.ts', import.meta.url), 'utf8');
  it.each([
    ['startup check', updater, 'setTimeout(() => { void checkForUpdates(); }, 5_000)'],
    ['four-hour checks', updater, 'FOUR_HOURS_MS'],
    ['stable/canary derivation', updater, "channel = requestedChannel === 'canary'"],
    ['Help check action', menu, 'Check for Updates...'],
    ['Help install/restart action', menu, 'Install Update and Restart'],
    ['normal-quit installation', updater, 'autoInstallOnAppQuit = true'],
  ])('preserves %s', (_name, source, marker) => expect(source).toContain(marker));
});
