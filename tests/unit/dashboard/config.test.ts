/**
 * Unit tests for ServerConfig service (PAN-428 B3)
 *
 * Tests port validation logic, env var precedence, default values,
 * and requireLinearApiKey / requireAnthropicApiKey typed errors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Effect } from 'effect';
import { ServerConfig, ServerConfigLayer, ServerConfigError } from '../../../src/dashboard/server/config.js';

// Prevent loadPanopticonEnv from loading ~/.panopticon.env during tests
// so env var presence/absence is fully controlled by the test.
vi.mock('../../../src/lib/env-loader.js', async () => {
  const { Effect } = await import('effect');
  return {
    loadPanopticonEnv: () => Effect.succeed({ loaded: [] as string[], skipped: [] as string[] }),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

type EnvSnapshot = Record<string, string | undefined>;

function captureEnv(keys: string[]): EnvSnapshot {
  return Object.fromEntries(keys.map((k) => [k, process.env[k]]));
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const [k, v] of Object.entries(snapshot)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

const ENV_KEYS = ['API_PORT', 'PORT', 'HOST', 'LINEAR_API_KEY', 'ANTHROPIC_API_KEY', 'DASHBOARD_URL', 'PANOPTICON_HOME'];

let envSnapshot: EnvSnapshot;

beforeEach(() => {
  envSnapshot = captureEnv(ENV_KEYS);
  // Clear all relevant env vars so each test starts from a clean baseline
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  restoreEnv(envSnapshot);
});

async function getConfig() {
  return Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () { return yield* ServerConfig; }),
      ServerConfigLayer,
    ),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ServerConfig', () => {
  describe('port resolution', () => {
    it('defaults to 3011 when no env vars set', async () => {
      const cfg = await getConfig();
      expect(cfg.port).toBe(3011);
    });

    it('reads port from API_PORT', async () => {
      process.env['API_PORT'] = '4000';
      const cfg = await getConfig();
      expect(cfg.port).toBe(4000);
    });

    it('falls back to PORT when API_PORT not set', async () => {
      process.env['PORT'] = '5000';
      const cfg = await getConfig();
      expect(cfg.port).toBe(5000);
    });

    it('API_PORT takes precedence over PORT', async () => {
      process.env['API_PORT'] = '4000';
      process.env['PORT'] = '5000';
      const cfg = await getConfig();
      expect(cfg.port).toBe(4000);
    });

    it('throws ServerConfigError on invalid port string', async () => {
      process.env['API_PORT'] = 'not-a-number';
      await expect(getConfig()).rejects.toThrow(ServerConfigError);
    });
  });

  describe('host', () => {
    it('defaults to 0.0.0.0 so panopticon-traefik (docker) can reach the host process', async () => {
      const cfg = await getConfig();
      expect(cfg.host).toBe('0.0.0.0');
    });

    it('reads HOST env var (lockdown to loopback)', async () => {
      process.env['HOST'] = '127.0.0.1';
      const cfg = await getConfig();
      expect(cfg.host).toBe('127.0.0.1');
    });
  });

  describe('optional API keys', () => {
    it('linearApiKey is null when LINEAR_API_KEY not set', async () => {
      const cfg = await getConfig();
      expect(cfg.linearApiKey).toBeNull();
    });

    it('linearApiKey reads LINEAR_API_KEY env var', async () => {
      process.env['LINEAR_API_KEY'] = 'lin_api_test';
      const cfg = await getConfig();
      expect(cfg.linearApiKey).toBe('lin_api_test');
    });

    it('anthropicApiKey is null when ANTHROPIC_API_KEY not set', async () => {
      const cfg = await getConfig();
      expect(cfg.anthropicApiKey).toBeNull();
    });
  });

  describe('requireLinearApiKey', () => {
    it('fails with ServerConfigError when key missing', async () => {
      const cfg = await getConfig();
      await expect(
        Effect.runPromise(cfg.requireLinearApiKey),
      ).rejects.toThrow(ServerConfigError);
    });

    it('succeeds when LINEAR_API_KEY is set', async () => {
      process.env['LINEAR_API_KEY'] = 'lin_api_test';
      const cfg = await getConfig();
      const key = await Effect.runPromise(cfg.requireLinearApiKey);
      expect(key).toBe('lin_api_test');
    });
  });

  describe('requireAnthropicApiKey', () => {
    it('fails with ServerConfigError when key missing', async () => {
      const cfg = await getConfig();
      await expect(
        Effect.runPromise(cfg.requireAnthropicApiKey),
      ).rejects.toThrow(ServerConfigError);
    });

    it('succeeds when ANTHROPIC_API_KEY is set', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test';
      const cfg = await getConfig();
      const key = await Effect.runPromise(cfg.requireAnthropicApiKey);
      expect(key).toBe('sk-ant-test');
    });
  });

  describe('dashboardUrl', () => {
    it('derives default from port', async () => {
      process.env['API_PORT'] = '4500';
      const cfg = await getConfig();
      expect(cfg.dashboardUrl).toBe('http://localhost:4500');
    });

    it('reads DASHBOARD_URL env var', async () => {
      process.env['DASHBOARD_URL'] = 'https://example.com';
      const cfg = await getConfig();
      expect(cfg.dashboardUrl).toBe('https://example.com');
    });
  });
});
