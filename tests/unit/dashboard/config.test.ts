/**
 * Unit tests for ServerConfig service (PAN-428 B3)
 *
 * Tests port validation logic, env var precedence, default values,
 * and requireLinearApiKey / requireAnthropicApiKey typed errors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { parse as parseYaml } from 'yaml';
import { ServerConfig, ServerConfigLayer, ServerConfigError } from '../../../src/dashboard/server/config.js';

// Prevent loadOverdeckEnv from loading ~/.overdeck.env during tests
// so env var presence/absence is fully controlled by the test.
vi.mock('../../../src/lib/env-loader.js', () => ({
  loadOverdeckEnv: () => ({ loaded: [], skipped: [] }),
  loadOverdeckEnvSync: () => ({ loaded: [], skipped: [] }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

type EnvSnapshot = Record<string, string | undefined>;

interface DevcontainerCompose {
  services?: {
    frontend?: {
      environment?: string[];
    };
    server?: {
      environment?: string[];
      labels?: string[];
    };
  };
}

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

const ENV_KEYS = [
  'API_PORT',
  'PORT',
  'HOST',
  'LINEAR_API_KEY',
  'ANTHROPIC_API_KEY',
  'DASHBOARD_URL',
  'OVERDECK_HOME',
  'OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY',
  'OVERDECK_AGENT_ID',
];

let envSnapshot: EnvSnapshot;

beforeEach(() => {
  envSnapshot = captureEnv(ENV_KEYS);
  // Clear all relevant env vars so each test starts from a clean baseline
  for (const k of ENV_KEYS) delete process.env[k];
  process.env['OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY'] = '1';
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

function readDevcontainerTemplate(): DevcontainerCompose {
  const template = readFileSync(
    resolve(process.cwd(), 'infra/.devcontainer-template/docker-compose.devcontainer.yml.template'),
    'utf-8',
  );
  const rendered = template.replace(/{{[A-Z_]+}}/g, (placeholder) => {
    const key = placeholder.slice(2, -2);
    return key === 'PROJECTS_DIR' ? '/home/test/Projects' : `test-${key.toLowerCase()}`;
  });
  return parseYaml(rendered) as DevcontainerCompose;
}

function envValue(environment: string[] | undefined, name: string): string | undefined {
  const prefix = `${name}=`;
  return environment?.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
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

    it('accepts the workspace devcontainer server env in peer mode', async () => {
      const compose = readDevcontainerTemplate();
      const serverEnv = compose.services?.server?.environment ?? [];
      const frontendEnv = compose.services?.frontend?.environment ?? [];
      const serverPort = envValue(serverEnv, 'PORT');
      const proxyTarget = envValue(frontendEnv, 'VITE_PROXY_TARGET');

      expect(serverPort).toBeDefined();
      expect(serverPort).not.toBe('3011');
      expect(proxyTarget).toBe(`http://server:${serverPort}`);
      expect(compose.services?.server?.labels ?? []).toContain(
        `traefik.http.services.pan-api-test-feature_folder.loadbalancer.server.port=${serverPort}`,
      );

      for (const entry of serverEnv) {
        const separator = entry.indexOf('=');
        if (separator === -1) continue;
        process.env[entry.slice(0, separator)] = entry.slice(separator + 1);
      }
      delete process.env['OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY'];

      const cfg = await getConfig();
      expect(cfg.port).toBe(Number(serverPort));
    });
  });

  describe('host', () => {
    it('defaults to 0.0.0.0 so overdeck-traefik (docker) can reach the host process', async () => {
      const cfg = await getConfig();
      expect(cfg.host).toBe('0.0.0.0');
    });

    it('reads HOST env var (lockdown to loopback)', async () => {
      process.env['HOST'] = '127.0.0.1';
      const cfg = await getConfig();
      expect(cfg.host).toBe('127.0.0.1');
    });
  });

  describe('workspace primary override identity gate', () => {
    it.each(['agent-pan-2545', 'planning-pan-2545', 'flywheel-orchestrator'])(
      'refuses the primary-port escape hatch for pipeline identity %s',
      async (agentId) => {
        process.env['OVERDECK_AGENT_ID'] = agentId;

        await expect(getConfig()).rejects.toThrow(
          `Refusing OVERDECK_WORKSPACE_DASHBOARD_ALLOW_PRIMARY=1 for pipeline-role identity`,
        );
      },
    );

    it.each([undefined, 'conv-20260709-6371'])(
      'allows the primary-port escape hatch for operator identity %s',
      async (agentId) => {
        if (agentId === undefined) delete process.env['OVERDECK_AGENT_ID'];
        else process.env['OVERDECK_AGENT_ID'] = agentId;

        await expect(getConfig()).resolves.toMatchObject({ port: 3011 });
      },
    );
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
