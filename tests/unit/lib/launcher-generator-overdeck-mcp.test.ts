import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateLauncherScript, type LauncherConfig } from '../../../src/lib/launcher-generator.js';
import { overdeckMcpArgs } from '../../../src/lib/mcp/overdeck-mcp-args.js';

let tempHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-overdeck-mcp-launcher-'));
  prevHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevHome;
  rmSync(tempHome, { recursive: true, force: true });
});

const CONFIG_PATH = '/h/agents/a/overdeck-mcp.json';

const WORK_CONFIG: LauncherConfig = {
  role: 'work',
  workingDir: '/workspace/project',
  baseCommand: 'claude --permission-mode default',
  promptFile: '/h/agents/a/prompt.md',
  overdeckEnv: { agentId: 'agent-a' },
};

function count(haystack: string, needle: RegExp): number {
  return haystack.match(new RegExp(needle.source, 'g'))?.length ?? 0;
}

describe('generateLauncherScript — overdeck MCP (PAN-4932)', () => {
  it('adds the equals-form flags before "$prompt" in a work launcher', () => {
    const script = generateLauncherScript({ ...WORK_CONFIG, overdeckMcpConfig: CONFIG_PATH });

    expect(script).toContain(`--mcp-config='${CONFIG_PATH}' --allowedTools=mcp__overdeck`);
    expect(count(script, /--allowedTools/)).toBe(1);
    const line = script.split('\n').find((l) => l.includes('--mcp-config='));
    expect(line).toBeDefined();
    expect(line!.indexOf('"$prompt"')).toBeGreaterThan(line!.indexOf('--allowedTools=mcp__overdeck'));
  });

  it('adds no second allow-list when the base command has one', () => {
    const script = generateLauncherScript({
      ...WORK_CONFIG,
      baseCommand: "claude --permission-mode default --allowedTools 'Read,Bash,mcp__overdeck'",
      overdeckMcpConfig: CONFIG_PATH,
    });

    expect(script).toContain(`--mcp-config='${CONFIG_PATH}'`);
    expect(count(script, /--allowedTools/)).toBe(1);
  });

  it('adds the flag in the conversation path', () => {
    const script = generateLauncherScript({ ...WORK_CONFIG, spawnMode: 'conversation', overdeckMcpConfig: CONFIG_PATH });
    expect(script).toContain(`--mcp-config='${CONFIG_PATH}'`);
  });

  it('keeps the Channels bridge config next to the overdeck config', () => {
    const script = generateLauncherScript({
      ...WORK_CONFIG,
      channelsBridgeMcpConfig: '/h/agents/a/.mcp.json',
      overdeckMcpConfig: CONFIG_PATH,
    });

    expect(script).toContain("--mcp-config '/h/agents/a/.mcp.json'");
    expect(script).toContain(`--mcp-config='${CONFIG_PATH}'`);
  });

  it('adds nothing for a kimi-code launch', () => {
    const script = generateLauncherScript({
      role: 'work',
      workingDir: '/workspace/project',
      harness: 'kimi-code',
      kimiCodeModel: 'k3',
      kimiCodeEffort: 'high',
      kimiCodeYolo: true,
      overdeckEnv: { agentId: 'agent-a' },
      overdeckMcpConfig: CONFIG_PATH,
    });

    expect(script).not.toContain('--mcp-config');
  });

  it('leaves the script unchanged when the field is unset', () => {
    const without = generateLauncherScript(WORK_CONFIG);
    const explicitUndefined = generateLauncherScript({ ...WORK_CONFIG, overdeckMcpConfig: undefined });

    expect(explicitUndefined).toBe(without);
    expect(without).not.toContain('--mcp-config');
    expect(without).not.toContain('--allowedTools');
  });
});

const ACP_CONFIG: LauncherConfig = {
  role: 'work',
  workingDir: '/workspace/project',
  harness: 'opencode',
  acpAgentId: 'agent-a',
  acpProvider: 'opencode',
  acpWorkspace: '/workspace/project',
  acpBinaryPath: '/opt/opencode',
  model: 'opencode/big-pickle',
  overdeckEnv: { agentId: 'agent-a' },
};

function hostLine(script: string): string {
  const line = script.split('\n').find((l) => l.includes('acp-host.js'));
  expect(line).toBeDefined();
  return line!;
}

describe('generateLauncherScript — overdeck MCP for ACP launches (PAN-4934)', () => {
  it('adds the host flag to an opencode launch', () => {
    const script = generateLauncherScript({ ...ACP_CONFIG, overdeckMcpConfig: CONFIG_PATH });
    const line = hostLine(script);

    expect(line).toContain(` --mcp-config '${CONFIG_PATH}'`);
    expect(count(line, /--mcp-config/)).toBe(1);
    expect(script).not.toContain('--allowedTools');
  });

  it('adds the host flag to a kimi acp launch', () => {
    const script = generateLauncherScript({
      ...ACP_CONFIG,
      harness: 'acp',
      acpProvider: 'kimi',
      model: 'kimi-for-coding',
      overdeckMcpConfig: CONFIG_PATH,
    });
    const line = hostLine(script);

    expect(line).toContain(` --mcp-config '${CONFIG_PATH}'`);
    expect(count(line, /--mcp-config/)).toBe(1);
    expect(script).not.toContain('--allowedTools');
  });

  it('adds no host flag when the field is unset', () => {
    expect(hostLine(generateLauncherScript(ACP_CONFIG))).not.toContain('--mcp-config');
  });
});

describe('overdeckMcpArgs — project servers and strict mode (PAN-5061)', () => {
  it('keeps the pre-PAN-5061 output without opts', () => {
    expect(overdeckMcpArgs(CONFIG_PATH, 'claude')).toBe(` --mcp-config='${CONFIG_PATH}' --allowedTools=mcp__overdeck`);
    expect(overdeckMcpArgs(undefined, 'claude')).toBe('');
  });

  it('allows every server in the launch MCP file', () => {
    expect(overdeckMcpArgs(CONFIG_PATH, 'claude', { serverNames: ['overdeck', 'sentry'] })).toBe(
      ` --mcp-config='${CONFIG_PATH}' --allowedTools=mcp__overdeck,mcp__sentry`,
    );
  });

  it('adds no allow-list when the command already has one', () => {
    expect(overdeckMcpArgs(CONFIG_PATH, "claude --allowedTools 'Read'", { serverNames: ['sentry'] })).toBe(
      ` --mcp-config='${CONFIG_PATH}'`,
    );
  });

  it('adds --strict-mcp-config with and without a config path', () => {
    expect(overdeckMcpArgs(CONFIG_PATH, 'claude', { strict: true })).toBe(
      ` --mcp-config='${CONFIG_PATH}' --allowedTools=mcp__overdeck --strict-mcp-config`,
    );
    expect(overdeckMcpArgs(undefined, 'claude', { strict: true })).toBe(' --strict-mcp-config');
  });
});

describe('generateLauncherScript — project MCP (PAN-5061)', () => {
  it('adds --strict-mcp-config to a Claude launcher with mcpStrict', () => {
    const script = generateLauncherScript({
      ...WORK_CONFIG,
      overdeckMcpConfig: CONFIG_PATH,
      overdeckMcpServerNames: ['overdeck', 'linear'],
      mcpStrict: true,
    });

    expect(script).toContain(`--mcp-config='${CONFIG_PATH}' --allowedTools=mcp__overdeck,mcp__linear --strict-mcp-config`);
  });

  it("keeps a role's space-form --mcp-config next to --strict-mcp-config", () => {
    const script = generateLauncherScript({
      ...WORK_CONFIG,
      role: 'test',
      baseCommand: "claude --permission-mode default --mcp-config '/h/agents/a/role-mcp.json'",
      overdeckMcpConfig: CONFIG_PATH,
      mcpStrict: true,
    });

    expect(script).toContain("--mcp-config '/h/agents/a/role-mcp.json'");
    expect(script).toContain(`--mcp-config='${CONFIG_PATH}'`);
    expect(script).toContain('--strict-mcp-config');
  });

  it('adds --strict-mcp-config in the conversation path', () => {
    const script = generateLauncherScript({ ...WORK_CONFIG, spawnMode: 'conversation', mcpStrict: true });
    expect(script).toContain('--strict-mcp-config');
  });
});
