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
