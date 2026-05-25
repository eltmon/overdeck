import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('traefik config generation', () => {
  let tempDir: string;
  let originalPanopticonHome: string | undefined;
  let originalPanopticonDev: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-traefik-test-'));
    originalPanopticonHome = process.env.PANOPTICON_HOME;
    originalPanopticonDev = process.env.PANOPTICON_DEV;
    process.env.PANOPTICON_HOME = tempDir;
    delete process.env.PANOPTICON_DEV;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalPanopticonHome === undefined) {
      delete process.env.PANOPTICON_HOME;
    } else {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    }

    if (originalPanopticonDev === undefined) {
      delete process.env.PANOPTICON_DEV;
    } else {
      process.env.PANOPTICON_DEV = originalPanopticonDev;
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

    const { generatePanopticonTraefikConfigSync } = await import('../../src/lib/traefik.js');

    expect(generatePanopticonTraefikConfigSync()).toBe(true);

    const rendered = readFileSync(join(tempDir, 'traefik', 'dynamic', 'panopticon.yml'), 'utf-8');

    expect(rendered).toContain('rule: "Host(`example.test`) && !PathPrefix(`/api`) && !PathPrefix(`/ws`)"');
    expect(rendered).toContain('rule: "Host(`example.test`) && (PathPrefix(`/api`) || PathPrefix(`/ws`))"');
    expect(rendered).toContain('url: "http://host.docker.internal:4102"');

    const artifactRouter = rendered.slice(
      rendered.indexOf('    panopticon-artifacts:'),
      rendered.indexOf('  services:'),
    );
    expect(artifactRouter).toContain('rule: "Host(`artifacts.example.test`) && PathPrefix(`/a/`)"');
    expect(artifactRouter).toContain('service: panopticon-api');
    expect(artifactRouter).toContain('- "*.example.test"');
  });
});
