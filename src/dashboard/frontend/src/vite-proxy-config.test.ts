import { describe, expect, it } from 'vitest';

import { resolveProxy } from '../vite.config';

// Inject the /.dockerenv probe so cases stay deterministic regardless of where
// the suite runs (host or CI container).
const noDocker = () => false;
const hasDocker = (p: string) => p === '/.dockerenv';

describe('vite dev proxy target (PAN-1153)', () => {
  it('host + Traefik enabled → 127.0.0.1, NOT the container host (the bug)', () => {
    const r = resolveProxy({ TRAEFIK_ENABLED: 'true' }, noDocker);
    expect(r.isContainerMode).toBe(false);
    expect(r.apiTarget).toBe('http://127.0.0.1:3011');
    expect(r.wsTarget).toBe('ws://127.0.0.1:3011');
    // Browser still reaches Vite via Traefik TLS, so HMR must use wss/443.
    expect(r.behindTraefik).toBe(true);
  });

  it('real container via CONTAINER_MODE → compose service host', () => {
    const r = resolveProxy({ CONTAINER_MODE: 'true' }, noDocker);
    expect(r.isContainerMode).toBe(true);
    expect(r.apiTarget).toBe('http://server:3011');
    expect(r.wsTarget).toBe('ws://server:3011');
    expect(r.behindTraefik).toBe(true);
  });

  it('real container via /.dockerenv → compose service host', () => {
    const r = resolveProxy({}, hasDocker);
    expect(r.isContainerMode).toBe(true);
    expect(r.apiTarget).toBe('http://server:3011');
  });

  it('plain host (no Traefik, no container) → 127.0.0.1 and no wss HMR override', () => {
    const r = resolveProxy({}, noDocker);
    expect(r.apiTarget).toBe('http://127.0.0.1:3011');
    expect(r.behindTraefik).toBe(false);
  });

  it('VITE_PROXY_TARGET overrides everything', () => {
    const r = resolveProxy({ VITE_PROXY_TARGET: 'http://localhost:3012', TRAEFIK_ENABLED: 'true' }, noDocker);
    expect(r.apiTarget).toBe('http://localhost:3012');
    expect(r.wsTarget).toBe('ws://localhost:3012');
  });
});
