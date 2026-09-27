/**
 * PAN-4264 Work Item 25: the opt-in operatorHash — a 16-hex HMAC of the
 * GitHub user id, absent unless operator grouping is on, and the hash file
 * never holds the raw id.
 */
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ grouping: false }));
vi.mock('../../../../src/lib/config-yaml.js', () => ({
  loadConfigSync: () => ({ config: { telemetry: { enabled: true, operator_grouping: config.grouping } } }),
}));

import {
  OPERATOR_HASH_SALT,
  computeOperatorHash,
  ensureOperatorHash,
  getOperatorHashIfEnabled,
} from '../../../../src/lib/telemetry/operator-hash.js';

describe('operatorHash (PAN-4264)', () => {
  const originalHome = process.env.OVERDECK_HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-operator-hash-'));
    process.env.OVERDECK_HOME = home;
    config.grouping = false;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('computes a 16-hex HMAC-SHA256 of the user id under the product salt', () => {
    const hash = computeOperatorHash(678719);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe(createHmac('sha256', OPERATOR_HASH_SALT).update('678719').digest('hex').slice(0, 16));
    expect(computeOperatorHash('678719')).toBe(hash);
  });

  it('is absent while grouping is off, even with a cached hash, and never calls gh', async () => {
    writeFileSync(join(home, 'telemetry-operator-hash'), `${computeOperatorHash(1)}\n`);
    const readUserId = vi.fn(async () => '678719');

    expect(getOperatorHashIfEnabled()).toBeUndefined();
    await ensureOperatorHash(readUserId);
    expect(readUserId).not.toHaveBeenCalled();
  });

  it('derives and caches only the hash, mode 0600, once grouping is on', async () => {
    config.grouping = true;
    const readUserId = vi.fn(async () => '678719\n');

    await ensureOperatorHash(readUserId);
    await ensureOperatorHash(readUserId);

    const file = join(home, 'telemetry-operator-hash');
    const stored = readFileSync(file, 'utf8');
    expect(stored.trim()).toBe(computeOperatorHash(678719));
    expect(stored).not.toContain('678719');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readUserId).toHaveBeenCalledTimes(1);
    expect(getOperatorHashIfEnabled()).toBe(computeOperatorHash(678719));
  });

  it('writes nothing when gh is unavailable', async () => {
    config.grouping = true;
    await ensureOperatorHash(async () => { throw new Error('gh: command not found'); });
    expect(existsSync(join(home, 'telemetry-operator-hash'))).toBe(false);
    expect(getOperatorHashIfEnabled()).toBeUndefined();
  });
});
