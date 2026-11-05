import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake CLI bundle, shared across this file's tests: prints its own argv so
// the generated shim's `exec` line is observable without running the real
// Overdeck CLI.
const fakeRoot = mkdtempSync(join(tmpdir(), 'pan-shim-launcher-fixture-'));
const fakeCliDir = join(fakeRoot, 'dist', 'cli');
mkdirSync(fakeCliDir, { recursive: true });
writeFileSync(join(fakeCliDir, 'index.js'), "console.log(JSON.stringify(process.argv.slice(2)));\n");

vi.mock('../../../src/lib/pan-cli-invocation.js', () => ({
  panCliInvocation: (args: readonly string[]) => ({
    command: process.execPath,
    args: [join(fakeCliDir, 'index.js'), ...args],
  }),
}));

const { generateLauncherScript } = await import('../../../src/lib/launcher-generator.js');
type LauncherConfig = Parameters<typeof generateLauncherScript>[0];

afterAll(() => {
  rmSync(fakeRoot, { recursive: true, force: true });
});

let tempHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-shim-launcher-home-'));
  prevHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
});

const BASE_CONFIG: LauncherConfig = {
  role: 'work',
  workingDir: '',
};

describe('generateLauncherScript — pan-cli-shim block (PAN-2630)', () => {
  it('puts <OVERDECK_HOME>/cli-bin ahead of the harness PATH line, and pan resolves there', () => {
    const launcherPath = join(tempHome, 'launcher.sh');
    const script = generateLauncherScript({
      ...BASE_CONFIG,
      workingDir: tempHome,
      extraEnvExports: ["export PATH='/harness/bin':\"$PATH\""],
      baseCommand: 'printenv PATH; command -v pan',
    });
    writeFileSync(launcherPath, script);

    const result = spawnSync('bash', [launcherPath], { encoding: 'utf-8' });

    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split('\n');
    const pathSegments = lines[0].split(':');
    expect(pathSegments[0]).toBe(join(tempHome, 'cli-bin'));
    expect(pathSegments[1]).toBe('/harness/bin');
    expect(lines.at(-1)).toBe(join(tempHome, 'cli-bin', 'pan'));
  });

  it('a remote launcher contains no cli-bin substring', () => {
    const script = generateLauncherScript({
      ...BASE_CONFIG,
      spawnMode: 'remote',
      baseCommand: 'true',
    });
    expect(script).not.toContain('cli-bin');
  });
});
