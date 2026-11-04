/**
 * PAN-4927 W-INJ4 (PAN-4935): claudeSystemPromptFiles picks the tools block
 * through the same gate the MCP injection checks (overdeckMcpEnabledFor).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mcpAgents = vi.hoisted(() => ({ value: true }));

vi.mock('../../../../src/lib/config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/config-yaml.js')>();
  return {
    ...actual,
    loadConfigNoMigration: vi.fn(async () => ({ config: { mcp: { agents: mcpAgents.value, public: { enabled: false } } } })),
  };
});

import { claudeSystemPromptFiles } from '../../../../src/lib/context-layers/launch-sources.js';

describe('claudeSystemPromptFiles tools block (PAN-4935 W-3)', () => {
  let root: string;
  let prevHome: string | undefined;
  let prevOverdeckHome: string | undefined;
  let workspace: string;

  beforeEach(() => {
    mcpAgents.value = true;
    root = mkdtempSync(join(tmpdir(), 'pan-launch-sources-tools-block-'));
    prevHome = process.env.HOME;
    prevOverdeckHome = process.env.OVERDECK_HOME;
    process.env.HOME = join(root, 'home');
    process.env.OVERDECK_HOME = join(root, 'home', '.overdeck');
    mkdirSync(join(root, 'home', '.overdeck', 'context'), { recursive: true });
    workspace = join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = prevOverdeckHome;
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  async function sharedLaunchFileContent(harness: Parameters<typeof claudeSystemPromptFiles>[1]): Promise<string> {
    const files = await claudeSystemPromptFiles(workspace, harness);
    return readFileSync(files[files.length - 2], 'utf8');
  }

  it('gives claude-code the MCP block when mcp.agents is true and Docker vars are unset', async () => {
    const files = await claudeSystemPromptFiles(workspace, 'claude-code');
    const sharedFile = files[files.length - 2];
    expect(sharedFile.endsWith('-mcp.md')).toBe(true);
    expect(readFileSync(sharedFile, 'utf8')).toContain('## Overdeck tools');
  });

  it('gives codex the MCP block under the same conditions', async () => {
    expect(await sharedLaunchFileContent('codex')).toContain('## Overdeck tools');
  });

  it('gives kimi-code the CLI block', async () => {
    const content = await sharedLaunchFileContent('kimi-code');
    expect(content).toContain('## Overdeck commands');
    expect(content).not.toContain('## Overdeck tools');
  });

  it('gives claude-code the CLI block in a Docker workspace', async () => {
    vi.stubEnv('OVERDECK_DOCKER_WORKSPACE', '1');
    const content = await sharedLaunchFileContent('claude-code');
    expect(content).toContain('## Overdeck commands');
  });

  it('gives claude-code the CLI block when mcp.agents is false', async () => {
    mcpAgents.value = false;
    const content = await sharedLaunchFileContent('claude-code');
    expect(content).toContain('## Overdeck commands');
  });
});
