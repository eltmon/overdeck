/**
 * PAN-4591 WI-3: the `semgrep` server reaches the launch MCP file and the Codex
 * server map, with sub-role plumbing (owner subRole, else state.json `reviewSubRole`),
 * fail-open behavior, the unprovisioned-harness warning, and the resumed-lane
 * `--allowedTools` force-allow.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ProjectMcpResult = Awaited<ReturnType<typeof import('../../projects/project-mcp.js').resolveProjectMcpServers>>;
const projectMcp = vi.hoisted(() => ({
  error: null as Error | null,
  result: { projectKey: null, servers: {}, strict: false } as ProjectMcpResult,
  calls: [] as Array<{ reservedNames: readonly string[] }>,
}));

vi.mock('../../projects/project-mcp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../projects/project-mcp.js')>();
  return {
    ...actual,
    resolveProjectMcpServers: vi.fn(async (input: { reservedNames: readonly string[] }) => {
      projectMcp.calls.push({ reservedNames: input.reservedNames });
      if (projectMcp.error) throw projectMcp.error;
      return projectMcp.result;
    }),
  };
});

vi.mock('../../skill-overrides/launch-pack-mcp.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../skill-overrides/launch-pack-mcp.js')>();
  return {
    ...actual,
    resolveLaunchPackMcpServers: vi.fn(async () => ({})),
  };
});

vi.mock('../../config-yaml.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config-yaml.js')>();
  return {
    ...actual,
    loadConfigNoMigration: vi.fn(async () => ({ config: { mcp: { agents: true, public: { enabled: false } } } })),
  };
});

type SemgrepServer = Awaited<ReturnType<typeof import('../../semgrep/in-session.js').resolveSemgrepMcpServer>>;
const semgrep = vi.hoisted(() => ({
  error: null as Error | null,
  result: null as SemgrepServer,
  calls: [] as Array<{ agentId: string; agentKind: string; role: string; subRole?: string }>,
}));

vi.mock('../../semgrep/in-session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../semgrep/in-session.js')>();
  return {
    ...actual,
    resolveSemgrepMcpServer: vi.fn(async (owner: { agentId: string; agentKind: string; role: string; subRole?: string }) => {
      semgrep.calls.push(owner);
      if (semgrep.error) throw semgrep.error;
      return semgrep.result;
    }),
  };
});

import {
  prepareClaudeOverdeckMcp,
  prepareCodexOverdeckMcp,
} from '../agent-injection.js';
import { overdeckMcpArgs } from '../overdeck-mcp-args.js';
import { generateLauncherScript } from '../../launcher-generator.js';
import { roleAgentDefinitionPath, roleSystemPromptInjection } from '../../agents/runtime-command.js';
import { _resetAccessTokensForTests, _settleAccessTokenWritesForTests } from '../../access-tokens.js';

const SEMGREP_SERVER = {
  type: 'stdio' as const,
  command: '/usr/bin/env',
  args: ['-u', 'SEMGREP_APP_TOKEN', '-u', 'SEMGREP_RULES', '/h/bin/semgrep', 'mcp'],
  env: { SEMGREP_ENABLE_VERSION_CHECK: '0' },
};

let home: string;
const originalHome = process.env.OVERDECK_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4591-semgrep-injection-'));
  process.env.OVERDECK_HOME = home;
  _resetAccessTokensForTests();
  projectMcp.error = null;
  projectMcp.result = { projectKey: null, servers: {}, strict: false };
  projectMcp.calls = [];
  semgrep.error = null;
  semgrep.result = null;
  semgrep.calls = [];
});

afterEach(async () => {
  await _settleAccessTokenWritesForTests();
  _resetAccessTokensForTests();
  vi.restoreAllMocks();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('semgrep MCP injection — Claude Code (PAN-4591 WI-3 ac1/ac2)', () => {
  it('writes mcpServers.semgrep and returns overdeckMcpServerNames containing semgrep for a review+security owner', async () => {
    semgrep.result = SEMGREP_SERVER;
    const result = await prepareClaudeOverdeckMcp({
      agentId: 'agent-review-1',
      agentKind: 'agent',
      role: 'review',
      subRole: 'security',
      harness: 'claude-code',
    });
    expect(result.overdeckMcpConfig).toBeDefined();
    const text = await readFile(result.overdeckMcpConfig!, 'utf8');
    const parsed = JSON.parse(text) as { mcpServers: Record<string, unknown> };
    expect(parsed.mcpServers.semgrep).toEqual(SEMGREP_SERVER);
    expect(result.overdeckMcpServerNames).toContain('semgrep');
    expect(overdeckMcpArgs(result.overdeckMcpConfig, 'claude', { serverNames: result.overdeckMcpServerNames })).toContain('mcp__semgrep');
    expect(result.overdeckMcpForceAllow).toEqual(['semgrep']);
    expect(semgrep.calls[0]).toMatchObject({ agentId: 'agent-review-1', agentKind: 'agent', role: 'review', subRole: 'security' });
  });

  it('passes the owner subRole straight through', async () => {
    semgrep.result = SEMGREP_SERVER;
    await prepareClaudeOverdeckMcp({ agentId: 'agent-review-2', agentKind: 'agent', role: 'review', subRole: 'security', harness: 'claude-code' });
    expect(semgrep.calls[0]?.subRole).toBe('security');
  });

  it('falls back to state.json reviewSubRole when the owner has none', async () => {
    semgrep.result = SEMGREP_SERVER;
    const agentId = 'agent-review-3';
    const dir = join(home, 'agents', agentId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'state.json'), JSON.stringify({ id: agentId, role: 'review', reviewSubRole: 'security' }));

    await prepareClaudeOverdeckMcp({ agentId, agentKind: 'agent', role: 'review', harness: 'claude-code' });
    expect(semgrep.calls[0]?.subRole).toBe('security');
  });

  it('a project server named semgrep is dropped only while the managed server is active', async () => {
    semgrep.result = SEMGREP_SERVER;
    await prepareClaudeOverdeckMcp({ agentId: 'agent-review-4', agentKind: 'agent', role: 'work', harness: 'claude-code' });
    expect(projectMcp.calls.at(-1)?.reservedNames).toContain('semgrep');

    semgrep.result = null;
    await prepareClaudeOverdeckMcp({ agentId: 'agent-review-5', agentKind: 'agent', role: 'work', harness: 'claude-code' });
    expect(projectMcp.calls.at(-1)?.reservedNames).not.toContain('semgrep');
  });
});

describe('semgrep MCP injection — Codex (PAN-4591 WI-3 ac3)', () => {
  it('returns a semgrep entry with defaultToolsApprovalMode approve', async () => {
    semgrep.result = SEMGREP_SERVER;
    const result = await prepareCodexOverdeckMcp({ agentId: 'agent-codex-1', agentKind: 'agent', role: 'work', harness: 'codex' });
    expect(result.semgrep).toEqual({ ...SEMGREP_SERVER, defaultToolsApprovalMode: 'approve' });
  });
});

describe('semgrep MCP injection — fail-open and warnings (PAN-4591 WI-3 ac4)', () => {
  it('resolves without a semgrep key and emits one warning when the resolver throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    semgrep.error = new Error('resolver exploded');
    const result = await prepareClaudeOverdeckMcp({ agentId: 'agent-review-6', agentKind: 'agent', role: 'work', harness: 'claude-code' });
    const text = result.overdeckMcpConfig ? await readFile(result.overdeckMcpConfig, 'utf8') : '{}';
    expect(JSON.parse(text).mcpServers?.semgrep).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('semgrep MCP skipped');
  });

  it('names semgrep in the unprovisioned-harness warning for pi', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    semgrep.result = SEMGREP_SERVER;
    expect(await prepareClaudeOverdeckMcp({ agentId: 'agent-pi-1', agentKind: 'agent', role: 'work', harness: 'pi' })).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('semgrep');
  });
});

describe('semgrep MCP injection — resumed-lane force-allow (PAN-4591 WI-3 ac6)', () => {
  it('appends --allowedTools=mcp__semgrep after an existing role allow-list', () => {
    const base = `claude ${roleSystemPromptInjection(roleAgentDefinitionPath('review'))}`;
    const args = overdeckMcpArgs('/h/agents/a/overdeck-mcp.json', base, {
      serverNames: ['overdeck', 'semgrep'],
      forceAllow: ['semgrep'],
    });
    expect(args).toContain('--allowedTools=mcp__semgrep');

    const script = generateLauncherScript({
      role: 'review',
      workingDir: '/workspace/project',
      baseCommand: base,
      promptFile: '/h/agents/a/prompt.md',
      overdeckEnv: { agentId: 'agent-a' },
      overdeckMcpConfig: '/h/agents/a/overdeck-mcp.json',
      overdeckMcpServerNames: ['overdeck', 'semgrep'],
      overdeckMcpForceAllow: ['semgrep'],
    });
    expect(script).toContain('mcp__overdeck');
    expect(script).toContain('--allowedTools=mcp__semgrep');
  });

  it('emits no extra --allowedTools for a project-only server list with no forceAllow', () => {
    const args = overdeckMcpArgs('/h/p.json', "claude --allowedTools 'Read'", { serverNames: ['sentry'] });
    expect(args).toBe(" --mcp-config='/h/p.json'");
  });
});
