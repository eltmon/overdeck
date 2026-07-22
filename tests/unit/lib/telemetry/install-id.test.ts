import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getOrCreateInstallId } from '../../../../src/lib/telemetry/install-id.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const originalOverdeckHome = process.env.OVERDECK_HOME;

let testHome: string;

describe('getOrCreateInstallId', () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'overdeck-telemetry-id-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
  });

  it('creates one stable UUIDv4 under OVERDECK_HOME with mode 0600', () => {
    const first = getOrCreateInstallId();
    const second = getOrCreateInstallId();
    const installIdPath = join(testHome, 'telemetry-id');

    expect(first).toMatch(UUID_V4_PATTERN);
    expect(second).toBe(first);
    expect(readFileSync(installIdPath, 'utf8').trim()).toBe(first);
    expect(statSync(installIdPath).mode & 0o777).toBe(0o600);
  });
});
