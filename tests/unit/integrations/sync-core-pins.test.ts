import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registrationFor, registrationLines } from '../../../src/lib/mcp/connector/connect-output.js';

// PAN-5486 W-1 (FR-1, NFR-2): one script writes every @overdeck/core pin under integrations/
// from the root package.json version, and --check reports drift.
const SCRIPT = new URL('../../../integrations/shared/sync-core-pins.mjs', import.meta.url).pathname;

const RUN_MCP = 'integrations/grok-build/scripts/run-mcp.sh';
const MCP_JSON = 'integrations/grok-bot/mcp.json';
const HERMES_README = 'integrations/hermes/README.md';
const NODE_MODULES_README = 'integrations/openclaw/node_modules/x/README.md';

function run(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const read = (root: string, path: string) => readFileSync(join(root, path), 'utf-8');

const FIXTURE_FILES: Record<string, string> = {
  [RUN_MCP]: '#!/usr/bin/env bash\nOVERDECK_CORE_VERSION="${OVERDECK_CORE_VERSION:-0.74.0}"\n',
  [MCP_JSON]: '{\n  "args": [\n    "@overdeck/core@0.77.0",\n  ]\n}\n',
  [HERMES_README]:
    'Run `npx -y @overdeck/core@<version> mcp connector serve`.\nCheck with `npm view @overdeck/core@<pin> version`.\n',
  [NODE_MODULES_README]: 'installs @overdeck/core@0.1.0\n',
};

function makeRoot(version = '1.2.3', files: Record<string, string> = FIXTURE_FILES): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-core-pins-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }) + '\n');
  for (const [path, text] of Object.entries(files)) write(root, path, text);
  return root;
}

const grokBotMcpJson = (version: string) =>
  registrationLines('grok-bot', registrationFor({ version, env: {} })).slice(1).join('\n') + '\n';

describe('sync-core-pins.mjs (fixture root)', () => {
  it('sync rewrites every pin to the root version', () => {
    const root = makeRoot();

    const result = run(['--root', root]);

    expect(result.status).toBe(0);
    expect(read(root, RUN_MCP)).toContain('OVERDECK_CORE_VERSION:-1.2.3}');
    expect(read(root, MCP_JSON)).toContain('"@overdeck/core@1.2.3",');
    expect(result.stdout).toContain(`updated ${RUN_MCP}`);
    expect(result.stdout).toContain(`updated ${MCP_JSON}`);
    expect(result.stdout).toContain('core pins: 2 at 1.2.3, 2 file(s) updated');
  });

  it('sync leaves placeholders and node_modules untouched', () => {
    const root = makeRoot();
    const hermes = readFileSync(join(root, HERMES_README));
    const nodeModules = readFileSync(join(root, NODE_MODULES_README));

    expect(run(['--root', root]).status).toBe(0);

    expect(readFileSync(join(root, HERMES_README))).toEqual(hermes);
    expect(readFileSync(join(root, NODE_MODULES_README))).toEqual(nodeModules);
  });

  it('check fails and names the one hand-edited pin', () => {
    const root = makeRoot();
    run(['--root', root]);
    const edited = read(root, MCP_JSON).replace('1.2.3', '0.77.0');
    write(root, MCP_JSON, edited);
    const runMcp = read(root, RUN_MCP);

    const result = run(['--check', '--root', root]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`✗ ${MCP_JSON}:3 pins 0.77.0, expected 1.2.3`);
    expect(result.stderr).toContain('run: node integrations/shared/sync-core-pins.mjs');
    expect(result.stderr).not.toContain('run-mcp.sh');
    expect(read(root, MCP_JSON)).toBe(edited);
    expect(read(root, RUN_MCP)).toBe(runMcp);
  });

  it('check passes after sync', () => {
    const root = makeRoot();
    run(['--root', root]);

    const result = run(['--check', '--root', root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('✓ 2 core pins match 1.2.3');
  });

  it('check fails when no pin exists', () => {
    const root = makeRoot('1.2.3', {});

    const result = run(['--check', '--root', root]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('✗ no core pins found under integrations/');
  });

  it('accepts a canary root version', () => {
    const root = makeRoot('1.3.0-canary.2');

    expect(run(['--root', root]).status).toBe(0);
    expect(read(root, MCP_JSON)).toContain('"@overdeck/core@1.3.0-canary.2",');

    const check = run(['--check', '--root', root]);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('✓ 2 core pins match 1.3.0-canary.2');
  });

  it('sync changes only the version digits', () => {
    const root = makeRoot('1.2.3', { [MCP_JSON]: grokBotMcpJson('0.77.0') });

    expect(run(['--root', root]).status).toBe(0);

    expect(read(root, MCP_JSON)).toBe(grokBotMcpJson('1.2.3'));
  });

  it('rejects a root version that is not a semver', () => {
    const root = makeRoot('latest');

    const result = run(['--root', root]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('✗ package.json version "latest" is not a semver');
    expect(read(root, MCP_JSON)).toBe(FIXTURE_FILES[MCP_JSON]);
  });

  it('rejects an unknown flag', () => {
    const result = run(['--bogus']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });
});

// PAN-5486 W-2 (FR-2, FR-6): CI and the release workflow's full-suite gate fail on a stale pin.
describe('integrations/ in this repository', () => {
  it('every committed core pin matches the root package.json version', () => {
    const rootVersion = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8'))
      .version as string;

    const result = run(['--check']);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(new RegExp(`^✓ \\d+ core pins match ${rootVersion.replace(/\./g, '\\.')}\\n`));
  });
});
