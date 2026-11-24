import { describe, expect, it, vi } from 'vitest';

import {
  isVitePing,
  isWakeRouterRequest,
  isWakingRequest,
  labelHostFromLabels,
  parseWakeHost,
  readWorkspaceLabelHost,
  renderWorkspaceWakeTraefikConfig,
  wakeDomains,
} from '../workspace-wake-host.js';

describe('parseWakeHost (PAN-5649)', () => {
  it('parses a workspace app host and strips the port', () => {
    expect(parseWakeHost('feature-pan-5649.overdeck.localhost:443')).toEqual({
      issueId: 'PAN-5649',
      domain: 'overdeck.localhost',
      hostname: 'feature-pan-5649.overdeck.localhost',
    });
  });

  it('lower-cases the host and upper-cases the issue id', () => {
    expect(parseWakeHost('FEATURE-MIN-1.myn.localhost')?.issueId).toBe('MIN-1');
    expect(parseWakeHost('FEATURE-MIN-1.myn.localhost')?.domain).toBe('myn.localhost');
  });

  it.each([
    'api-feature-pan-1.overdeck.localhost',
    'knowledge-6f.overdeck.localhost',
    'overdeck.localhost',
    'feature-pan.overdeck.localhost',
    '',
  ])('returns null for %s', (host) => {
    expect(parseWakeHost(host)).toBeNull();
  });

  it('returns null for a missing host', () => {
    expect(parseWakeHost(undefined)).toBeNull();
  });
});

describe('wakeDomains (PAN-5649)', () => {
  it('joins the traefik domain with every project dns domain, lower case', () => {
    const domains = wakeDomains('overdeck.localhost', { a: { workspace: { dns: { domain: 'MYN.localhost' } } }, b: {} });
    expect([...domains].sort()).toEqual(['myn.localhost', 'overdeck.localhost']);
  });

  it('defaults the traefik domain to overdeck.localhost', () => {
    expect([...wakeDomains(undefined, {})]).toEqual(['overdeck.localhost']);
  });
});

describe('isWakingRequest (PAN-5649)', () => {
  it('wakes for a request without sec-fetch-mode and for a navigation', () => {
    expect(isWakingRequest({})).toBe(true);
    expect(isWakingRequest({ 'sec-fetch-mode': 'navigate' })).toBe(true);
  });

  it.each(['no-cors', 'cors', 'websocket'])('does not wake for sec-fetch-mode %s', (mode) => {
    expect(isWakingRequest({ 'sec-fetch-mode': mode })).toBe(false);
  });

  it('never wakes for a Vite ping', () => {
    expect(isWakingRequest({ accept: 'text/x-vite-ping' })).toBe(false);
    expect(isVitePing({ accept: 'text/x-vite-ping, */*' })).toBe(true);
    expect(isVitePing({ accept: 'text/html' })).toBe(false);
  });
});

describe('isWakeRouterRequest (PAN-5649)', () => {
  it('is true only with the marker and a feature host', () => {
    expect(isWakeRouterRequest({ host: 'feature-pan-5649.overdeck.localhost', 'x-overdeck-wake-router': '1' })).toBe(true);
  });

  it('is false for a feature host without the marker', () => {
    expect(isWakeRouterRequest({ host: 'feature-pan-5649.overdeck.localhost' })).toBe(false);
  });

  it('is true for any host the wake router matches, even one the handler will reject (CodeRabbit 4675400958)', () => {
    expect(isWakeRouterRequest({ host: 'feature-pan-1.dev_test.localhost', 'x-overdeck-wake-router': '1' })).toBe(true);
  });

  it('is false for the dashboard host with the marker', () => {
    expect(isWakeRouterRequest({ host: 'overdeck.localhost', 'x-overdeck-wake-router': '1' })).toBe(false);
  });
});

describe('renderWorkspaceWakeTraefikConfig (PAN-5649)', () => {
  it('renders the wake router, marker middleware and dashboard service', () => {
    const yaml = renderWorkspaceWakeTraefikConfig(3011);
    expect(yaml).toContain('overdeck-workspace-wake:');
    expect(yaml).toContain('priority: 1');
    expect(yaml).toContain('X-Overdeck-Wake-Router: "1"');
    expect(yaml).toContain('- overdeck-workspace-wake-marker');
    expect(yaml).toContain('http://host.docker.internal:3011');
    expect(yaml).toContain('rule: "HostRegexp(`^feature-[a-z0-9]+-[0-9]+\\\\..+$`)"');
  });
});

describe('labelHostFromLabels (PAN-5649)', () => {
  it('returns the frontend router host and ignores the api router', () => {
    expect(
      labelHostFromLabels('PAN-5649', [
        { 'traefik.http.routers.pan-api-feature-pan-5649.rule': 'Host(`api-feature-pan-5649.overdeck.localhost`)' },
        { 'traefik.http.routers.pan-fe-feature-pan-5649.rule': 'Host(`feature-pan-5649.overdeck.localhost`)' },
      ]),
    ).toBe('feature-pan-5649.overdeck.localhost');
  });

  it('does not match a longer issue number', () => {
    expect(
      labelHostFromLabels('PAN-5649', [
        { 'traefik.http.routers.pan-fe-feature-pan-56490.rule': 'Host(`feature-pan-56490.overdeck.localhost`)' },
      ]),
    ).toBeNull();
  });

  it('reads a double-quoted Host rule (CodeRabbit 4675400968)', () => {
    expect(
      labelHostFromLabels('PAN-5649', [{ 'traefik.http.routers.fe.rule': 'Host("feature-pan-5649.overdeck.localhost")' }]),
    ).toBe('feature-pan-5649.overdeck.localhost');
  });

  it('ignores labels that are not router rules', () => {
    expect(
      labelHostFromLabels('PAN-5649', [{ 'com.example.note': 'Host(`feature-pan-5649.overdeck.localhost`)' }]),
    ).toBeNull();
  });
});

describe('readWorkspaceLabelHost (PAN-5649)', () => {
  it('ignores an inspected container of another compose project (CodeRabbit 4675400974)', async () => {
    const runDocker = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'ps') return 'pan-5649-frontend-1\n';
      return JSON.stringify({
        'com.docker.compose.project': 'someone-else',
        'traefik.http.routers.x.rule': 'Host(`feature-pan-5649.evil.localhost`)',
      });
    });
    expect(await readWorkspaceLabelHost('PAN-5649', 'overdeck-feature-pan-5649', { runDocker })).toBeNull();
  });

  it('makes no docker call for an invalid compose project', async () => {
    const runDocker = vi.fn(async () => '');
    expect(await readWorkspaceLabelHost('PAN-5649', 'bad project;rm', { runDocker })).toBeNull();
    expect(runDocker).not.toHaveBeenCalled();
  });

  it('returns null when docker fails', async () => {
    const runDocker = vi.fn(async () => null);
    expect(await readWorkspaceLabelHost('PAN-5649', 'overdeck-feature-pan-5649', { runDocker })).toBeNull();
    expect(runDocker).toHaveBeenCalledTimes(1);
  });

  it('reads the label host from the inspected labels', async () => {
    const runDocker = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'ps') return 'pan-5649-frontend-1\nbad name\npan-5649-server-1\n';
      return [
        JSON.stringify({
          'com.docker.compose.project': 'overdeck-feature-pan-5649',
          'traefik.http.routers.pan-fe-feature-pan-5649.rule': 'Host(`feature-pan-5649.overdeck.localhost`)',
        }),
        'not json',
        JSON.stringify({
          'com.docker.compose.project': 'overdeck-feature-pan-5649',
          'traefik.http.routers.pan-api-feature-pan-5649.rule': 'Host(`api-feature-pan-5649.overdeck.localhost`)',
        }),
      ].join('\n');
    });
    expect(await readWorkspaceLabelHost('PAN-5649', 'overdeck-feature-pan-5649', { runDocker })).toBe('feature-pan-5649.overdeck.localhost');
    expect(runDocker).toHaveBeenNthCalledWith(1, ['ps', '-a', '--filter', 'label=com.docker.compose.project=overdeck-feature-pan-5649', '--format', '{{.Names}}']);
    expect(runDocker).toHaveBeenNthCalledWith(2, ['inspect', '--format', '{{json .Config.Labels}}', 'pan-5649-frontend-1', 'pan-5649-server-1']);
  });
});
