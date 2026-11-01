import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('traefik config generation', () => {
  let tempDir: string;
  let originalOverdeckHome: string | undefined;
  let originalOverdeckDev: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-traefik-test-'));
    originalOverdeckHome = process.env.OVERDECK_HOME;
    originalOverdeckDev = process.env.OVERDECK_DEV;
    process.env.OVERDECK_HOME = tempDir;
    delete process.env.OVERDECK_DEV;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }

    if (originalOverdeckDev === undefined) {
      delete process.env.OVERDECK_DEV;
    } else {
      process.env.OVERDECK_DEV = originalOverdeckDev;
    }

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('renders dashboard and artifact host routes for the configured domain', async () => {
    writeFileSync(join(tempDir, 'config.toml'), [
      '[dashboard]',
      'port = 4101',
      'api_port = 4102',
      '',
      '[traefik]',
      'enabled = true',
      'domain = "example.test"',
      '',
    ].join('\n'));

    const { generateOverdeckTraefikConfig } = await import('../../src/lib/traefik.js');

    expect(generateOverdeckTraefikConfig()).toBe(true);

    const rendered = readFileSync(join(tempDir, 'traefik', 'dynamic', 'overdeck.yml'), 'utf-8');

    expect(rendered).toContain('rule: "Host(`example.test`) && !PathPrefix(`/api`) && !PathPrefix(`/ws`)"');
    expect(rendered).toContain('rule: "Host(`example.test`) && (PathPrefix(`/api`) || PathPrefix(`/ws`))"');
    expect(rendered).toContain('url: "http://host.docker.internal:4102"');

    const artifactRouter = rendered.slice(
      rendered.indexOf('    overdeck-artifacts:'),
      rendered.indexOf('  services:'),
    );
    expect(artifactRouter).toContain('rule: "Host(`artifacts.example.test`) && PathPrefix(`/a/`)"');
    expect(artifactRouter).toContain('service: overdeck-api');
    expect(artifactRouter).toContain('- "*.example.test"');
  });
});

describe('traefik compose migration — PAN-4299', () => {
  let tempDir: string;
  let originalOverdeckHome: string | undefined;

  const legacyCompose = [
    'services:',
    '  traefik:',
    '    ports:',
    '      - "80:80"       # HTTP (redirects to HTTPS)',
    '      - "443:443"     # HTTPS',
    '      - "8080:8080"   # Traefik Dashboard',
    '      - "8443:443"',
    '      - "3000:3000"',
    'networks:',
    '  overdeck:',
    '    name: overdeck',
    '    driver: bridge',
    '',
  ].join('\n');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-traefik-compose-test-'));
    originalOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = tempDir;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rewrites the 80/443/8080 lines to the bind address and keeps trailing comments', async () => {
    const { rewriteTraefikComposePorts } = await import('../../src/lib/traefik.js');
    const out = rewriteTraefikComposePorts(legacyCompose, '127.0.0.1');
    expect(out).toContain('      - "127.0.0.1:80:80"       # HTTP (redirects to HTTPS)');
    expect(out).toContain('      - "127.0.0.1:443:443"     # HTTPS');
    expect(out).toContain('      - "127.0.0.1:8080:8080"   # Traefik Dashboard');
  });

  it('replaces an existing host IP on an Overdeck port line', async () => {
    const { rewriteTraefikComposePorts } = await import('../../src/lib/traefik.js');
    expect(rewriteTraefikComposePorts('      - "0.0.0.0:443:443"', '127.0.0.1')).toBe('      - "127.0.0.1:443:443"');
    expect(rewriteTraefikComposePorts('      - "[::]:443:443"', '127.0.0.1')).toBe('      - "127.0.0.1:443:443"');
  });

  it('leaves other mappings untouched and is idempotent', async () => {
    const { rewriteTraefikComposePorts } = await import('../../src/lib/traefik.js');
    const once = rewriteTraefikComposePorts(legacyCompose, '127.0.0.1');
    expect(once).toContain('      - "8443:443"');
    expect(once).toContain('      - "3000:3000"');
    expect(rewriteTraefikComposePorts(once, '127.0.0.1')).toBe(once);
  });

  it('resolves unset and unknown bind values to loopback, and "all" to 0.0.0.0', async () => {
    const { resolveTraefikBindAddress } = await import('../../src/lib/traefik.js');
    expect(resolveTraefikBindAddress(undefined)).toBe('127.0.0.1');
    expect(resolveTraefikBindAddress('lan')).toBe('127.0.0.1');
    expect(resolveTraefikBindAddress('loopback')).toBe('127.0.0.1');
    expect(resolveTraefikBindAddress('all')).toBe('0.0.0.0');
  });

  it('migrates a legacy file to 0.0.0.0 when bind = "all", then reports no change', async () => {
    writeFileSync(join(tempDir, 'config.toml'), '[traefik]\nenabled = true\nbind = "all"\n');
    const composePath = join(tempDir, 'docker-compose.yml');
    writeFileSync(composePath, legacyCompose);
    const { migrateTraefikCompose } = await import('../../src/lib/traefik.js');

    expect(migrateTraefikCompose(composePath)).toBe(true);
    const migrated = readFileSync(composePath, 'utf-8');
    expect(migrated).toContain('"0.0.0.0:80:80"');
    expect(migrated).toContain('"0.0.0.0:443:443"');
    expect(migrated).toContain('"0.0.0.0:8080:8080"');
    expect(migrateTraefikCompose(composePath)).toBe(false);
  });

  it('migrates to 127.0.0.1 when bind is an unknown value', async () => {
    writeFileSync(join(tempDir, 'config.toml'), '[traefik]\nenabled = true\nbind = "lan"\n');
    const composePath = join(tempDir, 'docker-compose.yml');
    writeFileSync(composePath, legacyCompose);
    const { migrateTraefikCompose } = await import('../../src/lib/traefik.js');

    expect(migrateTraefikCompose(composePath)).toBe(true);
    expect(readFileSync(composePath, 'utf-8')).toContain('"127.0.0.1:443:443"');
  });

  it('upgrades the legacy driver: bridge network to external: true', async () => {
    const composePath = join(tempDir, 'docker-compose.yml');
    writeFileSync(composePath, legacyCompose);
    const { migrateTraefikCompose } = await import('../../src/lib/traefik.js');

    expect(migrateTraefikCompose(composePath)).toBe(true);
    const migrated = readFileSync(composePath, 'utf-8');
    expect(migrated).toContain('external: true');
    expect(migrated).not.toContain('driver: bridge');
  });

  it('returns false when the compose file does not exist', async () => {
    const { migrateTraefikCompose } = await import('../../src/lib/traefik.js');
    expect(migrateTraefikCompose(join(tempDir, 'missing.yml'))).toBe(false);
  });
});
