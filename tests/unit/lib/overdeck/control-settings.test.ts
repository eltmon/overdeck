import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';

import { closeOverdeckDatabase } from '../../../../src/lib/overdeck/infra.js';
import { ConfigResolver, ConfigResolverLive, isDeaconGloballyPaused, setDeaconGloballyPaused } from '../../../../src/lib/overdeck/control-settings.js';
import type { IssueId } from '../../../../src/lib/overdeck/issues.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeIssueId(s: string) {
  return s as IssueId;
}

// ── AC1: SettingsResolver.getFlywheelConfig reads flags from app_settings ───


// ── AC2: SettingsWriter persists to app_settings, no Records ─────────────────


describe('isDeaconGloballyPaused (PAN-5342)', () => {
  it('reports paused while the shutdown record exists, even with the flag false', () => {
    const previousHome = process.env.OVERDECK_HOME;
    const testHome = mkdtempSync(join(tmpdir(), 'pan-5342-control-settings-'));
    closeOverdeckDatabase();
    process.env.OVERDECK_HOME = testHome;

    try {
      setDeaconGloballyPaused(false);
      expect(isDeaconGloballyPaused()).toBe(false);
      writeFileSync(join(testHome, 'shutdown.json'), '{}');
      expect(isDeaconGloballyPaused()).toBe(true);
    } finally {
      closeOverdeckDatabase();
      if (previousHome === undefined) delete process.env.OVERDECK_HOME;
      else process.env.OVERDECK_HOME = previousHome;
      rmSync(testHome, { recursive: true, force: true });
    }
  });
});

// ── ConfigResolver — file-backed, no Db ──────────────────────────────────────

describe('ConfigResolver', () => {
  it('listProjects returns an array (real projects.yaml)', async () => {
    const result = await Effect.runPromise(
      ConfigResolver.use((r) => r.listProjects()).pipe(Effect.provide(ConfigResolverLive)),
    );
    // Just verify it's an array — the real YAML may have 0+ projects
    expect(Array.isArray(result)).toBe(true);
  });

  it('getProject returns ProjectNotFound for unknown key', async () => {
    const error = await Effect.runPromise(
      ConfigResolver.use((r) => r.getProject('no-such-project' as never))
        .pipe(Effect.provide(ConfigResolverLive))
        .pipe(Effect.flip),
    );
    expect(error._tag).toBe('ProjectNotFound');
  });
});
