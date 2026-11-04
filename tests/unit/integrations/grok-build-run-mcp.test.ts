import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// PAN-4955 W-INT3 WI-2: the Grok Build dispatch script execs the paired connector
// (capable pan, else pinned npx), or falls back to `pan mcp serve`.
const scriptPath = fileURLToPath(new URL('../../../integrations/grok-build/scripts/run-mcp.sh', import.meta.url));

function resolveBin(name: string): string {
  const result = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf-8' });
  const path = result.stdout.trim();
  if (!path) {
    throw new Error(`could not resolve ${name} on PATH`);
  }
  return path;
}

const absBash = resolveBin('bash');
const absGrep = resolveBin('grep');

let tmpDir: string;
let homeDir: string;
let stubsDir: string;
let sysDir: string;
let callsLog: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'grok-build-run-mcp-'));
  homeDir = join(tmpDir, 'home');
  stubsDir = join(tmpDir, 'stubs');
  sysDir = join(tmpDir, 'sys');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(stubsDir, { recursive: true });
  mkdirSync(sysDir, { recursive: true });
  symlinkSync(absGrep, join(sysDir, 'grep'));
  callsLog = join(tmpDir, 'calls.log');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function stub(name: string, body: string): void {
  const filePath = join(stubsDir, name);
  writeFileSync(filePath, `#!${absBash}\n${body}`);
  chmodSync(filePath, 0o755);
}

function panStub(capable: boolean): void {
  const helpLines = capable
    ? [
        'Usage: pan mcp [options] [command]',
        '',
        'Commands:',
        '  serve           Run the Overdeck MCP server',
        '  connector       Run an Overdeck connector',
      ]
    : ['Usage: pan mcp [options] [command]', '', 'Commands:', '  serve           Run the Overdeck MCP server'];
  const printHelp = helpLines.map((line) => `  echo '${line.replace(/'/g, "'\\''")}'`).join('\n');
  stub(
    'pan',
    [
      'if [ "$1" = "mcp" ] && [ "$2" = "--help" ]; then',
      printHelp,
      '  exit 0',
      'fi',
      `echo "pan $* TOKEN_FILE=\${OVERDECK_MCP_TOKEN_FILE:-}" >> "${callsLog}"`,
      'exit 0',
      '',
    ].join('\n'),
  );
}

function npxStub(): void {
  stub('npx', `echo "npx $*" >> "${callsLog}"\nexit 0\n`);
}

function writePairing(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pairing.json'), '{}');
}

function run(env: Record<string, string> = {}) {
  return spawnSync(absBash, [scriptPath], {
    env: { PATH: `${stubsDir}:${sysDir}`, HOME: homeDir, ...env },
    encoding: 'utf-8',
  });
}

describe('integrations/grok-build scripts/run-mcp.sh', () => {
  it('execs the connector via a capable pan when paired', () => {
    writePairing(join(homeDir, '.overdeck-connector'));
    panStub(true);

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(readFileSync(callsLog, 'utf-8').trim()).toBe('pan mcp connector serve --stdio TOKEN_FILE=');
  });

  it('falls back to a pinned npx when pan lacks the connector', () => {
    writePairing(join(homeDir, '.overdeck-connector'));
    panStub(false);
    npxStub();

    const result = run();

    expect(result.status).toBe(0);
    expect(readFileSync(callsLog, 'utf-8').trim()).toBe('npx -y @overdeck/core@0.74.0 mcp connector serve --stdio');
  });

  it('honors OVERDECK_CONNECTOR_HOME when the default home has no pairing', () => {
    const altHome = join(tmpDir, 'alt-connector-home');
    writePairing(altHome);
    panStub(true);

    const result = run({ OVERDECK_CONNECTOR_HOME: altHome });

    expect(result.status).toBe(0);
    expect(readFileSync(callsLog, 'utf-8').trim()).toBe('pan mcp connector serve --stdio TOKEN_FILE=');
    expect(existsSync(join(homeDir, '.overdeck-connector'))).toBe(false);
  });

  it('defaults OVERDECK_MCP_TOKEN_FILE to the token-setup path when unset', () => {
    panStub(true);
    mkdirSync(join(homeDir, '.overdeck'), { recursive: true });
    const tokenFile = join(homeDir, '.overdeck', 'grok-build-mcp-token');
    writeFileSync(tokenFile, 'secret');

    const result = run();

    expect(result.status).toBe(0);
    expect(readFileSync(callsLog, 'utf-8').trim()).toBe(`pan mcp serve TOKEN_FILE=${tokenFile}`);
  });

  it('leaves OVERDECK_MCP_TOKEN_FILE unset when OVERDECK_MCP_TOKEN is already set', () => {
    panStub(true);
    mkdirSync(join(homeDir, '.overdeck'), { recursive: true });
    writeFileSync(join(homeDir, '.overdeck', 'grok-build-mcp-token'), 'secret');

    const result = run({ OVERDECK_MCP_TOKEN: 'x' });

    expect(result.status).toBe(0);
    expect(readFileSync(callsLog, 'utf-8').trim()).toBe('pan mcp serve TOKEN_FILE=');
  });

  it('exits 1 with an install hint when neither pan nor a connector is available', () => {
    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Install Overdeck (npm i -g @overdeck/core) or pair a connector');
  });

  it('honors an OVERDECK_CORE_VERSION override for the npx fallback', () => {
    writePairing(join(homeDir, '.overdeck-connector'));
    panStub(false);
    npxStub();

    const result = run({ OVERDECK_CORE_VERSION: '0.75.1' });

    expect(result.status).toBe(0);
    expect(readFileSync(callsLog, 'utf-8').trim()).toBe('npx -y @overdeck/core@0.75.1 mcp connector serve --stdio');
  });

  it('is executable and syntactically valid bash', () => {
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
    expect(spawnSync(absBash, ['-n', scriptPath]).status).toBe(0);
  });

  it('pins an exact semver greater than 0.73.1', () => {
    const text = readFileSync(scriptPath, 'utf-8');
    const match = text.match(/OVERDECK_CORE_VERSION:-(\d+\.\d+\.\d+)\}/);
    expect(match).not.toBeNull();

    const [major, minor, patch] = match![1].split('.').map(Number);
    const isGreaterThan0731 = major > 0 || minor > 73 || (minor === 73 && patch > 1);
    expect(isGreaterThan0731).toBe(true);
  });
});
