import { describe, expect, it } from 'vitest';
import { getHarnessBehavior, getHarness } from '@overdeck/contracts';
import { buildOpenCodeAcpSpawnInput, resolveOpenCodeAuthMethodId, translateOpenCodeAcpModelId } from '../opencode.js';
import { resolveAcpProviderSupport, resolveAcpModelId } from '../providers.js';
import { getProviderForModelSync, getBuiltInDefaultHarness } from '../../providers.js';
import { getModelProviderSync, isOpenRouterModelSync } from '../../model-fallback.js';
import { canUseHarnessSync } from '../../harness-policy.js';
import { resolveExecutable } from '../../harness-binary.js';
import { generateLauncherScriptSync } from '../../launcher-generator.js';
import { mergeConfigs } from '../../config-yaml/merge.js';

const routes = ['opencode', 'opencode-go'] as const;

describe('OpenCode Go and Zen', () => {
  it.each(routes)('keeps %s model IDs distinct from other providers', (provider) => {
    const model = `${provider}/kimi-k3`;
    expect(getProviderForModelSync(model).name).toBe(provider);
    expect(getModelProviderSync(model)).toBe(provider);
    expect(isOpenRouterModelSync(model)).toBe(false);
    expect(getBuiltInDefaultHarness(provider)).toBe('opencode');
    expect(resolveAcpModelId(provider, model)).toBe(model);
    expect(resolveAcpProviderSupport(provider).buildSpawnInput).toBe(buildOpenCodeAcpSpawnInput);
    expect(canUseHarnessSync('opencode', model, 'api-key')).toEqual({ allowed: true });
    for (const harness of ['claude-code', 'ohmypi', 'codex', 'acp', 'kimi-code'] as const) {
      expect(canUseHarnessSync(harness, model, 'api-key').allowed).toBe(false);
    }
  });

  it('does not route another provider through OpenCode', () => {
    expect(canUseHarnessSync('opencode', 'k3', 'api-key').allowed).toBe(false);
    expect(() => translateOpenCodeAcpModelId('kimi/k3')).toThrow('Invalid OpenCode model');
  });

  it('starts a persistent ACP process with the selected binary and working directory', () => {
    expect(buildOpenCodeAcpSpawnInput({ binaryPath: '/tools/open code' }, '/workspace', { OPENCODE_API_KEY: 'test' })).toEqual({
      command: '/tools/open code', args: ['acp'], cwd: '/workspace', env: { OPENCODE_API_KEY: 'test' },
    });
    expect(resolveOpenCodeAuthMethodId({ protocolVersion: 1, authMethods: [{ id: 'opencode-login', name: 'Login with opencode' }] })).toBe('opencode-login');
    expect(() => resolveOpenCodeAuthMethodId({ protocolVersion: 1, authMethods: [] })).toThrow('opencode auth login');
  });

  it('finds the official installer location without relying on the dashboard PATH', async () => {
    expect(await resolveExecutable('opencode', {
      home: '/user', pathValue: '/usr/bin', allowLoginShell: false,
      accessExecutable: async (path) => { if (path !== '/user/.opencode/bin/opencode') throw new Error('missing'); },
    })).toBe('/user/.opencode/bin/opencode');
  });

  it('preserves existing harness behaviors and registers OpenCode with ACP lifecycle capabilities', () => {
    for (const harness of ['claude-code', 'ohmypi', 'codex', 'acp', 'kimi-code', 'opencode'] as const) {
      expect(getHarness({ runtime: harness })).toBe(harness);
      expect(getHarnessBehavior(harness).displayName).toBeTruthy();
    }
    expect(getHarnessBehavior('opencode')).toMatchObject({
      displayName: 'OpenCode', launchCommandKind: 'acp-host', deliveryKind: 'acp-host-rpc',
      readinessKind: 'acp-host-ready', transcriptKind: 'acp-jsonl', supportsConversationStreaming: true,
    });
  });

  it('keeps OpenCode provider settings and overrides through config normalization', () => {
    const { config } = mergeConfigs({ models: { providers: {
      opencode: { enabled: true, harness: 'opencode' },
      'opencode-go': { enabled: true, harness: 'opencode' },
    } } });
    expect(config.enabledProviders.has('opencode')).toBe(true);
    expect(config.enabledProviders.has('opencode-go')).toBe(true);
    expect(config.providerHarnesses.opencode).toBe('opencode');
  });

  it.each(routes)('launches and resumes %s through the host with model and effort intact', (provider) => {
    const script = generateLauncherScriptSync({
      role: 'work', baseCommand: 'acp-host', workingDir: '/workspace with spaces', harness: 'opencode',
      acpAgentId: 'conv-opencode', acpProvider: provider,
      acpWorkspace: '/workspace with spaces', acpBinaryPath: '/tools/opencode',
      acpContextFile: '/managed/context.md', model: `${provider}/kimi-k3`,
      resumeSessionId: 'ses_saved', acpEffort: 'high',
    });
    expect(script).toContain('acp-host.js');
    expect(script).toContain(`--provider '${provider}'`);
    expect(script).toContain(`--model '${provider}/kimi-k3'`);
    expect(script).toContain("--resume 'ses_saved'");
    expect(script).toContain("--effort 'high'");
    expect(script).not.toContain('opencode run');
  });
});
