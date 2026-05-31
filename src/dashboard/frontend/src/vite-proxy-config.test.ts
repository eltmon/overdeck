import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controls what `existsSync('/.dockerenv')` reports per-test, so the "host"
// cases stay deterministic even when the suite itself runs inside a container.
const dockerenv = { exists: false };

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: Parameters<typeof actual.existsSync>[0]) =>
      p === '/.dockerenv' ? dockerenv.exists : actual.existsSync(p),
  };
});

// Env keys this config reads — reset to a known-clean state before each load so
// scenarios can't leak into one another.
const ENV_KEYS = ['TRAEFIK_ENABLED', 'CONTAINER_MODE', 'VITE_PROXY_TARGET'] as const;

/**
 * Re-evaluate vite.config.ts under a given environment and return its resolved
 * server config. The config reads process.env at module-eval time, so we set
 * env directly + reset the module registry before each import. (process.env
 * mutation is used rather than vi.stubEnv to avoid stub-restore ordering
 * interacting with the re-imported, vite-transformed config module.)
 */
async function loadConfig(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, dockerenvExists = false) {
  dockerenv.exists = dockerenvExists;
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  vi.resetModules();
  const mod = await import('../vite.config');
  // defineConfig returns the config object verbatim.
  return (mod.default as { server: { proxy: Record<string, { target: string }>; hmr: unknown } }).server;
}

describe('vite dev proxy target (PAN-1153)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    dockerenv.exists = false;
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  it('host + Traefik enabled → proxies to 127.0.0.1, NOT the container host (the bug)', async () => {
    const server = await loadConfig({ TRAEFIK_ENABLED: 'true', CONTAINER_MODE: undefined });
    expect(server.proxy['/api'].target).toBe('http://127.0.0.1:3011');
    expect(server.proxy['/ws'].target).toBe('ws://127.0.0.1:3011');
    // Browser still reaches Vite via Traefik TLS, so HMR must use wss/443.
    expect(server.hmr).toMatchObject({ clientPort: 443, protocol: 'wss' });
  });

  it('real container via CONTAINER_MODE → proxies to the compose service host', async () => {
    const server = await loadConfig({ CONTAINER_MODE: 'true', TRAEFIK_ENABLED: undefined });
    expect(server.proxy['/api'].target).toBe('http://server:3011');
    expect(server.proxy['/ws'].target).toBe('ws://server:3011');
    expect(server.hmr).toMatchObject({ clientPort: 443, protocol: 'wss' });
  });

  it('real container via /.dockerenv → proxies to the compose service host', async () => {
    const server = await loadConfig({ CONTAINER_MODE: undefined, TRAEFIK_ENABLED: undefined }, true);
    expect(server.proxy['/api'].target).toBe('http://server:3011');
  });

  it('plain host (no Traefik, no container) → 127.0.0.1 and no wss HMR override', async () => {
    const server = await loadConfig({ TRAEFIK_ENABLED: undefined, CONTAINER_MODE: undefined });
    expect(server.proxy['/api'].target).toBe('http://127.0.0.1:3011');
    expect(server.hmr).toBeUndefined();
  });

  it('VITE_PROXY_TARGET overrides everything', async () => {
    const server = await loadConfig({
      VITE_PROXY_TARGET: 'http://localhost:3012',
      TRAEFIK_ENABLED: 'true',
    });
    expect(server.proxy['/api'].target).toBe('http://localhost:3012');
    expect(server.proxy['/ws'].target).toBe('ws://localhost:3012');
  });
});
