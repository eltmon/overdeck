/**
 * Route-helper tests for buildHarnessPolicyDecisions (PAN-2528).
 *
 * The helper is the per-model decision-building loop extracted from
 * GET /api/settings/harness-policy. It accepts an injected auth-mode resolver
 * so the block-matrix can be exercised without spinning up an Effect HTTP
 * server.
 *
 * AC matrix:
 *  - ac1: anthropic + subscription → ohmypi decision is blocked with reason
 *  - ac2: response carries an 'ohmypi' key (no 'pi' key required by callers)
 *  - ac3: non-Anthropic model, OR anthropic + api-key, → ohmypi is allowed
 *  - ac4: a unit test produces the decision map without spawning a live server
 */

import { describe, it, expect } from 'vitest';

import {
  buildHarnessPolicyDecisions,
  parseHarnessPolicyModels,
} from '../../../../../src/lib/harness-policy-decisions.js';
import { OHMYPI_ANTHROPIC_SUBSCRIPTION_BLOCK_REASON } from '../../../../../src/lib/harness-policy.js';
import type { AuthMode } from '../../../../../src/lib/subscription-types.js';

type Resolver = (model: string) => Promise<AuthMode | undefined>;

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const OPENAI_MODEL = 'gpt-5.4';

/** Build a resolver that returns a fixed auth mode for the Anthropic provider. */
function authModeResolver(anthropicAuthMode: AuthMode | undefined): Resolver {
  return async (model) => {
    // Mirror getProviderForModelSync routing for the two test providers.
    if (model === ANTHROPIC_MODEL) return anthropicAuthMode;
    return undefined;
  };
}

describe('buildHarnessPolicyDecisions', () => {
  it('ac1: blocks ohmypi for Anthropic + subscription with a non-empty reason', async () => {
    const decisions = await buildHarnessPolicyDecisions(
      [ANTHROPIC_MODEL],
      authModeResolver('subscription'),
    );

    const ohmypi = decisions[ANTHROPIC_MODEL]?.ohmypi;
    expect(ohmypi).toBeDefined();
    expect(ohmypi?.allowed).toBe(false);
    expect(ohmypi?.reason).toBeTruthy();
    expect(ohmypi?.reason?.length).toBeGreaterThan(0);
    // The canonical reason string from harness-policy.ts is reused so the
    // picker UI can show the same message the server would return.
    expect(ohmypi?.reason).toBe(OHMYPI_ANTHROPIC_SUBSCRIPTION_BLOCK_REASON);
  });

  it('ac2: emits an "ohmypi" key (no legacy "pi" key) for every model', async () => {
    const decisions = await buildHarnessPolicyDecisions(
      [ANTHROPIC_MODEL, OPENAI_MODEL],
      authModeResolver('subscription'),
    );

    for (const model of [ANTHROPIC_MODEL, OPENAI_MODEL]) {
      const perModel = decisions[model];
      expect(perModel).toBeDefined();
      expect(perModel).toHaveProperty('ohmypi');
      // The legacy 'pi' key is intentionally absent — pickers query 'ohmypi'.
      expect(perModel).not.toHaveProperty('pi');
      // Runtime-name members are all present.
      expect(perModel).toHaveProperty('claude-code');
      expect(perModel).toHaveProperty('codex');
      expect(perModel).toHaveProperty('acp');
      expect(perModel).toHaveProperty('kimi-code');
    }
  });

  it('ac3a: allows ohmypi for Anthropic + api-key (no ToS bar engaged)', async () => {
    const decisions = await buildHarnessPolicyDecisions(
      [ANTHROPIC_MODEL],
      authModeResolver('api-key'),
    );

    expect(decisions[ANTHROPIC_MODEL]?.ohmypi).toEqual({ allowed: true });
  });

  it('ac3b: allows ohmypi for non-Anthropic models regardless of auth mode', async () => {
    const decisions = await buildHarnessPolicyDecisions(
      [OPENAI_MODEL],
      authModeResolver('subscription'),
    );

    expect(decisions[OPENAI_MODEL]?.ohmypi).toEqual({ allowed: true });
  });

  it('keeps claude-code and codex available for Anthropic + subscription', async () => {
    const decisions = await buildHarnessPolicyDecisions(
      [ANTHROPIC_MODEL],
      authModeResolver('subscription'),
    );

    expect(decisions[ANTHROPIC_MODEL]?.['claude-code']).toEqual({ allowed: true });
    expect(decisions[ANTHROPIC_MODEL]?.codex).toEqual({ allowed: true });
  });

  it('ac4: produces the decision map without spawning a live Effect HTTP server', async () => {
    // The whole point of the extraction: this test runs without an Effect
    // Layer, an HTTP listener, or any dashboard process — it only depends on
    // the injected resolver and the pure policy helpers.
    const resolverCalls: string[] = [];
    const resolver: Resolver = async (model) => {
      resolverCalls.push(model);
      return model === ANTHROPIC_MODEL ? 'subscription' : undefined;
    };

    const decisions = await buildHarnessPolicyDecisions(
      [ANTHROPIC_MODEL, OPENAI_MODEL],
      resolver,
    );

    expect(decisions[ANTHROPIC_MODEL]?.ohmypi?.allowed).toBe(false);
    expect(decisions[OPENAI_MODEL]?.ohmypi?.allowed).toBe(true);
    // The resolver was called once per unique model.
    expect(resolverCalls).toEqual([ANTHROPIC_MODEL, OPENAI_MODEL]);
  });

  it('caches the auth-mode resolver per provider when models share a provider', async () => {
    const SECOND_ANTHROPIC_MODEL = 'claude-haiku-4-5';
    const resolverCalls: string[] = [];
    const resolver: Resolver = async (model) => {
      resolverCalls.push(model);
      return 'subscription';
    };

    await buildHarnessPolicyDecisions(
      [ANTHROPIC_MODEL, SECOND_ANTHROPIC_MODEL],
      resolver,
    );

    // Both Anthropic models share the same provider — the resolver should
    // only run once for the whole batch (matches the route's prior behavior).
    expect(resolverCalls).toEqual([ANTHROPIC_MODEL]);
  });
});
/**
 * Query-validation tests for the `?models=` parameter.
 *
 * The pickers batch every known model id into ONE request, so a single
 * rejected id 400s the whole batch and every model silently loses its policy
 * decision. Bracketed long-context ids (`k3[1m]`, `claude-opus-5[1m]`) were
 * rejected by the original character class, which took out all 43 ids the
 * dashboard sends on each page load.
 */
describe('parseHarnessPolicyModels', () => {
  it('accepts bracketed long-context model ids', () => {
    expect(parseHarnessPolicyModels('k3[1m]')).toEqual(['k3[1m]']);
    expect(parseHarnessPolicyModels('claude-opus-5[1m]')).toEqual(['claude-opus-5[1m]']);
  });

  it('does not let one bracketed id reject the whole batch', () => {
    const batch = 'claude-opus-5,k3[1m],qwen/qwen3.6-plus,gpt-5.3-codex';
    expect(parseHarnessPolicyModels(batch)).toEqual([
      'claude-opus-5',
      'k3[1m]',
      'qwen/qwen3.6-plus',
      'gpt-5.3-codex',
    ]);
  });

  it('still accepts the slash, dot, colon and dash ids already in use', () => {
    const batch = 'nvidia/nemotron-3-ultra-550b-a55b:free,gpt-5.4-mini,minimax-m2.7-highspeed';
    expect(parseHarnessPolicyModels(batch)).toHaveLength(3);
  });

  it('trims whitespace and drops empty segments', () => {
    expect(parseHarnessPolicyModels(' claude-opus-5 , ,gpt-5.5 ')).toEqual([
      'claude-opus-5',
      'gpt-5.5',
    ]);
  });

  it('rejects missing, empty, and injection-shaped values', () => {
    expect(parseHarnessPolicyModels(null)).toBeNull();
    expect(parseHarnessPolicyModels('')).toBeNull();
    expect(parseHarnessPolicyModels('../../etc/passwd\0')).toBeNull();
    expect(parseHarnessPolicyModels('model name with spaces')).toBeNull();
    expect(parseHarnessPolicyModels('<script>')).toBeNull();
  });

  it('rejects an over-long id and an over-large batch', () => {
    expect(parseHarnessPolicyModels('a'.repeat(201))).toBeNull();
    expect(parseHarnessPolicyModels(Array.from({ length: 251 }, () => 'm').join(','))).toBeNull();
  });
});
