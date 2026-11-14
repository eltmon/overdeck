import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildCliproxyConfigV8, type CliproxyConfigInput } from '../../src/lib/cliproxy-config.js';

const CLIENT_TOKEN = 'overdeck-local-cliproxy-key';

function input(overrides: Partial<CliproxyConfigInput> = {}): CliproxyConfigInput {
  return {
    host: '127.0.0.1',
    port: 8317,
    clientToken: CLIENT_TOKEN,
    authDir: '/home/test/.overdeck/cliproxy/auth',
    geminiApiKey: null,
    managementKey: 'generated-management-key',
    extra: {},
    ...overrides,
  };
}

const CODEX_ALIASES: Array<[string, string]> = [
  ['gpt-5.6-luna', 'claude-haiku-4-5'],
  ['gpt-5.6-luna', 'claude-haiku-4-5-20251001'],
  ['gpt-5.6-luna', 'claude-3-5-haiku-20241022'],
  ['gpt-5.6-terra', 'claude-sonnet-5'],
  ['gpt-5.6-terra', 'claude-sonnet-4-6'],
  ['gpt-5.6-terra', 'claude-sonnet-4-5-20250929'],
  ['gpt-6-sol', 'claude-opus-5'],
  ['gpt-6-sol', 'claude-opus-4-6'],
  ['gpt-6-sol', 'claude-fable-5'],
];

/** The operator's legacy-layout config.extra.yaml shape (PAN-5282 PRD item 3). */
function operatorExtra(): Record<string, unknown> {
  return {
    'oauth-model-alias': {
      codex: CODEX_ALIASES.map(([name, alias]) => ({ name, alias })),
    },
    'remote-management': { 'allow-remote': false, 'secret-key': 'extra-plain-key' },
    routing: { strategy: 'round-robin', 'session-affinity': true, 'session-affinity-ttl': '1h' },
  };
}

function parsed(overrides: Partial<CliproxyConfigInput> = {}): Record<string, any> {
  return parseYaml(buildCliproxyConfigV8(input(overrides)).yaml) as Record<string, any>;
}

describe('buildCliproxyConfigV8 base config', () => {
  it('writes config-version 8 with server, access, management, routing, oauth sections', () => {
    const config = parsed();
    expect(config['config-version']).toBe(8);
    expect(config.server).toEqual({ host: '127.0.0.1', port: 8317 });
    expect(config.access['api-keys']).toEqual([CLIENT_TOKEN]);
    expect(config.management).toEqual({ 'allow-remote': false, 'secret-key': 'generated-management-key' });
    expect(config.routing).toEqual({
      strategy: 'round-robin',
      'session-affinity': true,
      'session-affinity-ttl': '1h',
    });
    expect(config.observability.logs.debug).toBe(false);
    expect(config.oauth['auth-dir']).toBe('/home/test/.overdeck/cliproxy/auth');
  });

  it('gemini key lands in api-keys.gemini', () => {
    const config = parsed({ geminiApiKey: 'fake-gemini-key' });
    expect(config['api-keys'].gemini[0].name).toBe('overdeck-gemini');
    expect(config['api-keys'].gemini[0].keys[0]['api-key']).toBe('fake-gemini-key');
  });

  it('omits the api-keys root when there is no gemini key', () => {
    expect(parsed()).not.toHaveProperty('api-keys');
  });
});

describe('buildCliproxyConfigV8 extra merge', () => {
  it('merges extra over generated values', () => {
    const config = parsed({ extra: { routing: { 'session-affinity-ttl': '2h' } } });
    expect(config.routing['session-affinity-ttl']).toBe('2h');
    expect(config.routing.strategy).toBe('round-robin');
    expect(config.routing['session-affinity']).toBe(true);
  });

  it('converts legacy remote-management and oauth-model-alias from extra', () => {
    const config = parsed({ extra: operatorExtra() });
    expect(Object.keys(config)).not.toContain('oauth-model-alias');
    expect(Object.keys(config)).not.toContain('remote-management');
    expect(config.oauth['model-alias'].codex).toHaveLength(9);
    expect(config.oauth['auth-dir']).toBe('/home/test/.overdeck/cliproxy/auth');
    expect(config.management).toEqual({ 'allow-remote': false, 'secret-key': 'extra-plain-key' });
  });

  it('a legacy api-keys list moves to access.api-keys and a mapping stays at the root', () => {
    const fromList = parsed({ extra: { 'api-keys': ['legacy-client-key'] } });
    expect(fromList.access['api-keys']).toEqual(['legacy-client-key', CLIENT_TOKEN]);
    expect(fromList).not.toHaveProperty('api-keys');

    const group = { gemini: [{ name: 'operator', keys: [{ 'api-key': 'operator-key' }] }] };
    const fromMapping = parsed({ extra: { 'api-keys': group } });
    expect(fromMapping['api-keys']).toEqual(group);
    expect(fromMapping.access['api-keys']).toEqual([CLIENT_TOKEN]);
  });

  it('a v8 key in extra beats its legacy twin in extra', () => {
    const config = parsed({
      extra: {
        'remote-management': { 'secret-key': 'legacy-key', 'allow-remote': true },
        management: { 'secret-key': 'v8-key' },
        debug: true,
        observability: { logs: { debug: false } },
      },
    });
    expect(config.management['secret-key']).toBe('v8-key');
    expect(config.management['allow-remote']).toBe(true);
    expect(config.observability.logs.debug).toBe(false);
  });

  it('keeps the overdeck client token when extra replaces access.api-keys', () => {
    expect(parsed({ extra: { access: { 'api-keys': ['other-key'] } } }).access['api-keys'])
      .toEqual(['other-key', CLIENT_TOKEN]);
    expect(parsed({ extra: { access: { 'api-keys': null } } }).access['api-keys']).toEqual([CLIENT_TOKEN]);
    expect(parsed({ extra: { access: null } }).access['api-keys']).toEqual([CLIENT_TOKEN]);
  });

  it('extra plaintext secret-key wins and becomes the active key', () => {
    const out = buildCliproxyConfigV8(input({ extra: operatorExtra() }));
    expect(out.activeManagementKey).toBe('extra-plain-key');
    expect(out.warnings).toEqual([]);
  });

  it('a bcrypt-shaped extra secret-key is ignored with a warning', () => {
    const out = buildCliproxyConfigV8(input({
      extra: { management: { 'secret-key': '$2a$10$abcdefghijklmnopqrstuv' } },
    }));
    expect(out.activeManagementKey).toBe('generated-management-key');
    expect((parseYaml(out.yaml) as Record<string, any>).management['secret-key']).toBe('generated-management-key');
    expect(out.warnings).toEqual([
      'config.extra.yaml management secret-key is a bcrypt hash; using the key in management-key instead',
    ]);
  });

  it('a non-mapping management section in extra falls back to the generated key', () => {
    const out = buildCliproxyConfigV8(input({ extra: { management: 'oops' } }));
    expect(out.activeManagementKey).toBe('generated-management-key');
    expect(out.config.management).toEqual({ 'secret-key': 'generated-management-key' });
  });
});

describe('buildCliproxyConfigV8 claude exclusion', () => {
  it('excludes every codex alias from the claude channel and keeps existing exclusions', () => {
    const extra = { ...operatorExtra(), oauth: { 'excluded-models': { claude: ['claude-3-opus'] } } };
    const config = parsed({ extra });
    const expected = [...CODEX_ALIASES.map(([, alias]) => alias), 'claude-3-opus'].sort();
    expect(config.oauth['excluded-models'].claude).toEqual(expected);
    expect(config.oauth['excluded-models'].claude).toHaveLength(10);
  });

  it('given the operator fixture the top-level sections appear once and the claude list is the sorted alias set', () => {
    const config = parsed({ extra: operatorExtra() });
    const keys = Object.keys(config);
    for (const section of ['routing', 'management', 'oauth']) {
      expect(keys.filter((key) => key === section)).toHaveLength(1);
    }
    expect(config.oauth['excluded-models'].claude).toEqual(CODEX_ALIASES.map(([, alias]) => alias).sort());
  });

  it('writes no claude exclusion when there are no codex aliases', () => {
    const config = parsed({ extra: { routing: { strategy: 'fill-first' } } });
    expect(config.oauth).not.toHaveProperty('excluded-models');
  });

  it('keeps other excluded-models channels', () => {
    const config = parsed({
      extra: { ...operatorExtra(), 'oauth-excluded-models': { codex: ['gpt-5-codex-mini'] } },
    });
    expect(config.oauth['excluded-models'].codex).toEqual(['gpt-5-codex-mini']);
    expect(config.oauth['excluded-models'].claude).toHaveLength(9);
    expect(config).not.toHaveProperty('oauth-excluded-models');
  });
});
