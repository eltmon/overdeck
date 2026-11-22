import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as NodeServices from '@effect/platform-node/NodeServices';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { ChildProcessSpawner } from 'effect/unstable/process';
import { describe, expect, it } from 'vitest';
import type * as EffectAcpSchema from 'effect-acp/schema';

import { ANTIGRAVITY_AUTH_REQUIRED, type AntigravityCredential } from '../../antigravity-auth.js';
import {
  ANTIGRAVITY_EFFORT_CONFIG_ID,
  buildAntigravityAcpSpawnInput,
  clampAntigravityThoughtLevel,
  extractAntigravityTurnUsage,
  makeAntigravityAcpRuntime,
  resolveAntigravityAuthMethodId,
} from '../antigravity.js';
import { resolveAcpModelId, resolveAcpProviderSupport } from '../providers.js';

const initializeWith = (ids: readonly string[]): EffectAcpSchema.InitializeResponse =>
  ({ protocolVersion: 1, authMethods: ids.map((id) => ({ id, name: id })) }) as unknown as EffectAcpSchema.InitializeResponse;

/** The authMethods `agy acp` 1.5.14 advertised during planning (PRD finding 2). */
const AGY_AUTH_METHODS = ['oauth-personal', 'oauth-business', 'gemini-api-key', 'agent-platform'];

const API_KEY_CREDENTIAL: AntigravityCredential = {
  method: 'gemini-api-key',
  env: { GEMINI_API_KEY: 'test-gemini-key' },
  source: 'settings',
};

const AGENT_PLATFORM_CREDENTIAL: AntigravityCredential = {
  method: 'agent-platform',
  env: { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_LOCATION: 'us-central1' },
  source: 'agent-platform',
};

describe('Antigravity ACP spawn input (PAN-5587 D7)', () => {
  it('starts a persistent agy acp server in the isolated gemini dir', () => {
    const spawn = buildAntigravityAcpSpawnInput(
      { binaryPath: '/tools/agy', geminiDir: '/tmp-free/abs/dir' },
      '/workspace',
      { PATH: '/usr/bin' },
      API_KEY_CREDENTIAL,
    );
    expect(spawn.command).toBe('/tools/agy');
    expect(spawn.args).toEqual(['acp', '--gemini-dir', '/tmp-free/abs/dir']);
    expect(spawn.cwd).toBe('/workspace');
  });

  it('falls back to agy on PATH when no binary path is configured', () => {
    expect(buildAntigravityAcpSpawnInput(null, '/workspace', {}, API_KEY_CREDENTIAL).command).toBe('agy');
  });

  it('drops inherited Google credentials and carries only the resolved key', () => {
    const spawn = buildAntigravityAcpSpawnInput(
      { geminiDir: '/tmp-free/abs/dir' },
      '/workspace',
      { PATH: '/usr/bin', GOOGLE_API_KEY: 'inherited-google', GEMINI_API_KEY: 'inherited-gemini' },
      API_KEY_CREDENTIAL,
    );
    expect(spawn.env).toEqual({ PATH: '/usr/bin', GEMINI_API_KEY: 'test-gemini-key' });
  });

  it('leaves no GEMINI_API_KEY for an Agent Platform credential', () => {
    const spawn = buildAntigravityAcpSpawnInput(
      { geminiDir: '/tmp-free/abs/dir' },
      '/workspace',
      { PATH: '/usr/bin', GEMINI_API_KEY: 'inherited-gemini', GOOGLE_CLOUD_PROJECT: 'inherited-project' },
      AGENT_PLATFORM_CREDENTIAL,
    );
    expect(spawn.env).toEqual({ PATH: '/usr/bin', GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_LOCATION: 'us-central1' });
    expect(spawn.env).not.toHaveProperty('GEMINI_API_KEY');
  });
});

describe('makeAntigravityAcpRuntime (PAN-5587 D5, D6)', () => {
  const runFactory = (geminiDir: string, credential: AntigravityCredential | undefined, onSpawn: () => void) =>
    Effect.runPromiseExit(
      makeAntigravityAcpRuntime({
        childProcessSpawner: ChildProcessSpawner.make(() =>
          Effect.sync(onSpawn).pipe(Effect.andThen(Effect.die(new Error('spawn stopped by test'))))),
        binaryPath: '/tools/agy',
        geminiDir,
        environment: {},
        cwd: '/workspace',
        clientInfo: { name: 'overdeck-test', version: '0.0.0' },
        ...(credential ? { credential } : {}),
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );

  it('creates the isolated gemini dir before agy is spawned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antigravity-runtime-'));
    const geminiDir = join(root, 'nested', 'antigravity');
    const existedAtSpawn: boolean[] = [];
    try {
      await runFactory(geminiDir, API_KEY_CREDENTIAL, () => existedAtSpawn.push(existsSync(geminiDir)));
      expect(existsSync(geminiDir)).toBe(true);
      expect(existedAtSpawn).toEqual([true]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('dies with ANTIGRAVITY_AUTH_REQUIRED and spawns nothing without a credential', async () => {
    let spawned = false;
    const exit = await runFactory(join(tmpdir(), 'antigravity-never-created'), undefined, () => { spawned = true; });
    expect(Exit.isFailure(exit)).toBe(true);
    expect(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : '').toContain(ANTIGRAVITY_AUTH_REQUIRED);
    expect(spawned).toBe(false);
  });
});

describe('Antigravity ACP auth method (PAN-5587 D3)', () => {
  it('selects gemini-api-key from the advertised methods', () => {
    expect(resolveAntigravityAuthMethodId(initializeWith(AGY_AUTH_METHODS), 'gemini-api-key')).toBe('gemini-api-key');
  });

  it('selects agent-platform when the credential asks for it', () => {
    expect(resolveAntigravityAuthMethodId(initializeWith(AGY_AUTH_METHODS), 'agent-platform')).toBe('agent-platform');
  });

  it('refuses to fall back to an OAuth method', () => {
    expect(() => resolveAntigravityAuthMethodId(initializeWith(['oauth-personal', 'oauth-business']), 'gemini-api-key'))
      .toThrow('Antigravity CLI does not offer gemini-api-key auth.');
  });

  it('never selects an OAuth method even when asked', () => {
    expect(() => resolveAntigravityAuthMethodId(initializeWith(AGY_AUTH_METHODS), 'oauth-personal' as never))
      .toThrow('clause 6');
  });
});

describe('clampAntigravityThoughtLevel (PAN-5587 D11)', () => {
  it('steps down to the highest offered level below the request', () => {
    expect(clampAntigravityThoughtLevel('medium', ['low', 'high'])).toBe('low');
    expect(clampAntigravityThoughtLevel('xhigh', ['low', 'medium', 'high'])).toBe('high');
  });

  it('keeps an offered level', () => {
    expect(clampAntigravityThoughtLevel('high', ['low', 'medium', 'high'])).toBe('high');
  });

  it('uses the lowest offered level when nothing ranks below the request', () => {
    expect(clampAntigravityThoughtLevel('low', ['medium', 'high'])).toBe('medium');
  });

  it('throws when no known level is offered', () => {
    expect(() => clampAntigravityThoughtLevel('high', ['turbo'])).toThrow('Antigravity offered no thought levels.');
  });
});

describe('extractAntigravityTurnUsage (PAN-5587 D12)', () => {
  it('maps ACP-standard usage onto the Overdeck model id', () => {
    const response = {
      stopReason: 'end_turn',
      usage: { inputTokens: 12101, outputTokens: 117, cachedReadTokens: 7739, cachedWriteTokens: 0, thoughtTokens: 0, totalTokens: 19957 },
    } as unknown as EffectAcpSchema.PromptResponse;
    expect(extractAntigravityTurnUsage(response, 'gemini-4-argon')).toEqual({
      model: 'gemini-4-argon',
      source: 'antigravity',
      inputTokens: 12101,
      outputTokens: 117,
      cacheReadTokens: 7739,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
    });
  });

  it('returns undefined for a turn without usage', () => {
    expect(extractAntigravityTurnUsage({ stopReason: 'end_turn' } as EffectAcpSchema.PromptResponse, 'gemini-4-argon')).toBeUndefined();
  });
});

describe('antigravity ACP provider support', () => {
  it('translates the Overdeck model id to the agy value', () => {
    expect(resolveAcpModelId('antigravity', 'gemini-3.1-pro-preview')).toBe('gemini-3.1-pro');
  });

  it('records the antigravity harness and its thought_level effort option', () => {
    const support = resolveAcpProviderSupport('antigravity');
    expect(support.harness).toBe('antigravity');
    expect(support.effortConfigId).toBe(ANTIGRAVITY_EFFORT_CONFIG_ID);
    expect(support.displayName).toBe('Antigravity');
    expect(typeof support.resolveCredential).toBe('function');
    expect(resolveAcpProviderSupport('grok').displayName).toBe('Grok Build');
  });
});
