/**
 * PAN-5165 WI-4: resolveLaunchPackMcpServers resolves one launch's pack MCP
 * servers against mocked pack catalog and skill-override layers (no fs, no git).
 */
import { describe, expect, it, vi } from 'vitest';

const { loadSkillOverrideLayers, listPackCatalog, getSupervisedConversationByTmuxSession, readIssuePipeline } = vi.hoisted(() => ({
  loadSkillOverrideLayers: vi.fn(),
  listPackCatalog: vi.fn(),
  getSupervisedConversationByTmuxSession: vi.fn(),
  readIssuePipeline: vi.fn(async () => 'overdeck'),
}));

vi.mock('../store.js', () => ({ loadSkillOverrideLayers }));
vi.mock('../catalog.js', () => ({ listPackCatalog }));
vi.mock('../../deft/issue-pipeline.js', () => ({ readIssuePipeline }));
vi.mock('../../overdeck/conversations.js', () => ({ getSupervisedConversationByTmuxSession }));
vi.mock('../../projects.js', () => ({ resolveProjectKeyForCwdAsync: vi.fn(async () => 'proj') }));

import { resolveLaunchPackMcpServers } from '../launch-pack-mcp.js';

const COMMIT = 'e'.repeat(40);
const ctx = { cwd: '/repo/workspaces/feature-pan-1' };
const skill = (name: string, optIn = false) => ({ name, dir: `skills/${name}`, description: `${name}.`, optIn });

function atlassianCatalogEntry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'atlassian',
    url: 'https://github.com/atlassian/atlassian-mcp-server',
    ref: '3be5562',
    commit: COMMIT,
    adapter: 'claude-plugin',
    cached: true,
    manifest: {
      skills: [skill('jira-sprint-dashboard'), skill('triage-issue', true)],
      capabilities: {
        hooks: false, mcpServers: false, commands: false, agents: false, contextInjection: false, gitHooks: false,
        executables: [], projectMutatingSkills: ['triage-issue'], requiresCli: [],
      },
      license: 'Apache',
      pluginName: 'atlassian',
      mcpServers: { atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp', headers: {} } },
    },
    mcp: true,
    ...overrides,
  };
}

function packCatalogEntry(id: string, serverName: string, url: string): Record<string, unknown> {
  return {
    id,
    url: `https://example.com/${id}`,
    ref: 'main',
    commit: COMMIT,
    adapter: 'claude-plugin',
    cached: true,
    manifest: {
      skills: [skill('default')],
      capabilities: {
        hooks: false, mcpServers: false, commands: false, agents: false, contextInjection: false, gitHooks: false,
        executables: [], projectMutatingSkills: [], requiresCli: [],
      },
      license: null,
      pluginName: id,
      mcpServers: { [serverName]: { type: 'http', url, headers: {} } },
    },
    mcp: true,
  };
}

function reset(): void {
  loadSkillOverrideLayers.mockReset();
  listPackCatalog.mockReset();
  getSupervisedConversationByTmuxSession.mockReset();
  readIssuePipeline.mockClear();
}

describe('resolveLaunchPackMcpServers (PAN-5165)', () => {
  it('returns a consented pack server toggled on globally', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry()]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { atlassian: true } } });
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn });
    expect(result).toEqual({ atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp', headers: {} } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns {} when the pack toggle is off and no pack skill is on', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry()]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {} });
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn });
    expect(result).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns {} with one warning when the pack is on but not consented', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry({ mcp: undefined })]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { atlassian: true } } });
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn });
    expect(result).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pan skills pack update atlassian'));
  });

  it('skips a reserved name with one warning', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry()]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { atlassian: true } } });
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: ['atlassian'], warn });
    expect(result).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[pack-mcp] atlassian: server atlassian skipped'));
  });

  it('keeps the lower-id pack server on a name collision and warns once for the other', async () => {
    reset();
    listPackCatalog.mockResolvedValue([
      packCatalogEntry('a-pack', 'docs', 'https://a.example/docs'),
      packCatalogEntry('b-pack', 'docs', 'https://b.example/docs'),
    ]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { 'a-pack': true, 'b-pack': true } } });
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn });
    expect(result).toEqual({ docs: { type: 'http', url: 'https://a.example/docs', headers: {} } });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('b-pack'));
  });

  it('returns the server when only the opt-in skill is turned on per skill, with no pack toggle', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry()]);
    loadSkillOverrideLayers.mockResolvedValue({ global: { 'atlassian/triage-issue': true } });
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn });
    expect(result).toEqual({ atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp', headers: {} } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns {} with one warning when the catalog read throws', async () => {
    reset();
    listPackCatalog.mockRejectedValue(new Error('cache unavailable'));
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn });
    expect(result).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[pack-mcp] pack MCP servers skipped'));
  });

  it('passes the conversation session through to pack selection', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry()]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {} });
    getSupervisedConversationByTmuxSession.mockReturnValue({ skillOverrides: { 'atlassian/triage-issue': true } });
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, conversation: 'conv-x', reservedNames: [], warn });
    expect(getSupervisedConversationByTmuxSession).toHaveBeenCalledWith('conv-x');
    expect(result).toEqual({ atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp', headers: {} } });
  });
});
