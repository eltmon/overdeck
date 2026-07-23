import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getOrCreateInstallId } from '../../../../src/lib/telemetry/install-id.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const originalOverdeckHome = process.env.OVERDECK_HOME;

let testHome: string;

function readInstallIdFromChild(overdeckHome: string): Promise<string> {
  const moduleUrl = pathToFileURL(join(
    import.meta.dirname,
    '../../../../src/lib/telemetry/install-id.ts',
  )).href;
  const script = `
    import { getOrCreateInstallId } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(getOrCreateInstallId());
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--import', 'tsx', '--input-type=module', '--eval', script,
    ], {
      env: { ...process.env, OVERDECK_HOME: overdeckHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`install-ID child exited ${code}: ${stderr}`));
    });
  });
}

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

  it.each(['', 'partial-id', '123e4567-e89b-12d3-a456-426614174000'])(
    'atomically repairs invalid persisted content %j',
    (invalidContent) => {
      const installIdPath = join(testHome, 'telemetry-id');
      writeFileSync(installIdPath, invalidContent, { mode: 0o644 });

      const repaired = getOrCreateInstallId();

      expect(repaired).toMatch(UUID_V4_PATTERN);
      expect(readFileSync(installIdPath, 'utf8').trim()).toBe(repaired);
      expect(statSync(installIdPath).mode & 0o777).toBe(0o600);
      expect(getOrCreateInstallId()).toBe(repaired);
    },
  );

  it('returns one durable winner during concurrent invalid-file repair', async () => {
    const installIdPath = join(testHome, 'telemetry-id');
    writeFileSync(installIdPath, 'partial-id', { mode: 0o644 });

    const [first, second] = await Promise.all([
      readInstallIdFromChild(testHome),
      readInstallIdFromChild(testHome),
    ]);
    const durable = readFileSync(installIdPath, 'utf8').trim();

    expect(first).toMatch(UUID_V4_PATTERN);
    expect(second).toBe(first);
    expect(durable).toBe(first);
    expect(statSync(installIdPath).mode & 0o777).toBe(0o600);
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
