/**
 * PAN-5165 WI-4: resolveLaunchPackMcpServers resolves one launch's pack MCP
 * servers against mocked pack catalog and skill-override layers (no fs, no git).
 */
import { describe, expect, it, vi } from 'vitest';

const { loadSkillOverrideLayers, listPackCatalog, getSupervisedConversationByTmuxSession, readIssuePipeline, loadConfigNoMigration } = vi.hoisted(() => ({
  loadSkillOverrideLayers: vi.fn(),
  listPackCatalog: vi.fn(),
  getSupervisedConversationByTmuxSession: vi.fn(),
  readIssuePipeline: vi.fn(async () => 'overdeck'),
  loadConfigNoMigration: vi.fn(async () => ({ config: { trackerKeys: {} } })),
}));

vi.mock('../store.js', () => ({ loadSkillOverrideLayers }));
vi.mock('../catalog.js', () => ({ listPackCatalog }));
vi.mock('../../deft/issue-pipeline.js', () => ({ readIssuePipeline }));
vi.mock('../../overdeck/conversations.js', () => ({ getSupervisedConversationByTmuxSession }));
vi.mock('../../projects.js', () => ({ resolveProjectKeyForCwdAsync: vi.fn(async () => 'proj') }));
vi.mock('../../config-yaml.js', () => ({ loadConfigNoMigration }));

import { resolveLaunchPackMcpServers } from '../launch-pack-mcp.js';
import { atlassianBasicAuth, atlassianNeedsInteractiveAuth, withAtlassianAuth } from '../../skill-packs/atlassian.js';

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

  it('attaches the Jira Basic header to the atlassian server when tracker keys are set (PAN-5165 WI-5)', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry()]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { atlassian: true } } });
    loadConfigNoMigration.mockResolvedValueOnce({ config: { trackerKeys: { jira: 't0k', jiraEmail: 'a@b.com' } } });
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn });
    expect(result).toEqual({
      atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp', headers: { Authorization: 'Basic YUBiLmNvbTp0MGs=' } },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('attaches no header when the Jira email is missing', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry()]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { atlassian: true } } });
    loadConfigNoMigration.mockResolvedValueOnce({ config: { trackerKeys: { jira: 't0k' } } });
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn: vi.fn() });
    expect(result.atlassian?.headers).toEqual({});
  });

  it('keeps an unrelated pack\'s server when the tracker-key read for atlassian fails (review PAN-5165)', async () => {
    reset();
    listPackCatalog.mockResolvedValue([
      packCatalogEntry('a-pack', 'docs', 'https://a.example/docs'),
      atlassianCatalogEntry(),
    ]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { 'a-pack': true, atlassian: true } } });
    loadConfigNoMigration.mockRejectedValueOnce(new Error('config.yaml is malformed'));
    const warn = vi.fn();
    const result = await resolveLaunchPackMcpServers({ ...ctx, reservedNames: [], warn });
    expect(result).toEqual({
      docs: { type: 'http', url: 'https://a.example/docs', headers: {} },
      atlassian: { type: 'http', url: 'https://mcp.atlassian.com/v2/mcp', headers: {} },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tracker keys unavailable'));
  });
});

describe('atlassianBasicAuth / withAtlassianAuth / atlassianNeedsInteractiveAuth (PAN-5165 WI-5)', () => {
  const server = (url: string, headers: Record<string, string> = {}) => ({ url, headers });

  it('builds a Basic header from the Jira email and token', () => {
    expect(atlassianBasicAuth({ jira: 't0k', jiraEmail: 'a@b.com' })).toBe('Basic YUBiLmNvbTp0MGs=');
  });

  it('returns null when the token or the email is missing', () => {
    expect(atlassianBasicAuth({ jira: 't0k' })).toBeNull();
    expect(atlassianBasicAuth({ jiraEmail: 'a@b.com' })).toBeNull();
    expect(atlassianBasicAuth(undefined)).toBeNull();
  });

  it('returns null for a Data Center site and a header for a Cloud site', () => {
    expect(atlassianBasicAuth({ jira: 't0k', jiraEmail: 'a@b.com', jiraBaseUrl: 'https://jira.corp.example' })).toBeNull();
    expect(atlassianBasicAuth({ jira: 't0k', jiraEmail: 'a@b.com', jiraBaseUrl: 'https://acme.atlassian.net' })).toBe(
      'Basic YUBiLmNvbTp0MGs=',
    );
  });

  it('adds the header only to an https mcp.atlassian.com server, never to a look-alike host or plain http', () => {
    const keys = { jira: 't0k', jiraEmail: 'a@b.com' };
    const servers = withAtlassianAuth(
      {
        atlassian: server('https://mcp.atlassian.com/v2/mcp'),
        evil: server('https://mcp.atlassian.com.evil.example/v2/mcp'),
        plain: server('http://mcp.atlassian.com/v2/mcp'),
      },
      keys,
    );
    expect(servers.atlassian?.headers).toEqual({ Authorization: 'Basic YUBiLmNvbTp0MGs=' });
    expect(servers.evil?.headers).toEqual({});
    expect(servers.plain?.headers).toEqual({});
  });

  it('keeps an existing authorization header unchanged and never mutates the input', () => {
    const keys = { jira: 't0k', jiraEmail: 'a@b.com' };
    const input = { atlassian: server('https://mcp.atlassian.com/v2/mcp', { authorization: 'Bearer existing' }) };
    const servers = withAtlassianAuth(input, keys);
    expect(servers.atlassian?.headers).toEqual({ authorization: 'Bearer existing' });
    expect(input.atlassian.headers).toEqual({ authorization: 'Bearer existing' });
    expect(servers.atlassian).not.toBe(input.atlassian);
  });

  it('atlassianNeedsInteractiveAuth is true only for a header-less https mcp.atlassian.com server', () => {
    expect(atlassianNeedsInteractiveAuth(server('https://mcp.atlassian.com/v2/mcp'))).toBe(true);
    expect(atlassianNeedsInteractiveAuth(server('https://mcp.atlassian.com/v2/mcp', { Authorization: 'Bearer x' }))).toBe(false);
    expect(atlassianNeedsInteractiveAuth(server('https://mcp.other.example/v2/mcp'))).toBe(false);
  });

  it('never leaks the token or the Basic header value to a warn callback', async () => {
    reset();
    listPackCatalog.mockResolvedValue([atlassianCatalogEntry()]);
    loadSkillOverrideLayers.mockResolvedValue({ global: {}, packs: { global: { atlassian: true } } });
    loadConfigNoMigration.mockResolvedValueOnce({ config: { trackerKeys: { jira: 't0k', jiraEmail: 'a@b.com' } } });
    const warn = vi.fn();
    await resolveLaunchPackMcpServers({ ...ctx, reservedNames: ['atlassian'], warn });
    for (const call of warn.mock.calls) {
      expect(call[0]).not.toContain('t0k');
      expect(call[0]).not.toContain('YUBiLmNvbTp0MGs=');
    }
  });
});
