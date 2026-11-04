import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateLauncherScript, type LauncherConfig } from '../../../src/lib/launcher-generator.js';

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
