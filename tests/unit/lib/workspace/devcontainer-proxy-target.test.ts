import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  createWorkspacePlaceholders,
  processTemplates,
} from '../../../../src/lib/workspace/devcontainer-renderer.js';
import type { ProjectConfig, TemplatePlaceholders } from '../../../../src/lib/workspace-config.js';

const TEMPLATE_DIR = 'infra/.devcontainer-template';
const COMPOSE = 'docker-compose.devcontainer.yml';

interface ComposeService {
  environment?: string[];
  networks?: unknown;
  labels?: string[];
}

interface Compose {
  services?: Record<string, ComposeService | undefined>;
}

const tempDirs: string[] = [];

function render(featureName: string, overrides: Partial<TemplatePlaceholders> = {}): Compose {
  const projectConfig = {
    name: 'overdeck',
    path: process.cwd(),
    workspace: { docker: { compose_template: TEMPLATE_DIR } },
  } as ProjectConfig;
  const out = mkdtempSync(join(tmpdir(), 'pan-5330-'));
  tempDirs.push(out);
  const placeholders = createWorkspacePlaceholders(projectConfig, featureName, out, overrides);
  processTemplates(resolve(TEMPLATE_DIR), out, placeholders, [
    { source: `${COMPOSE}.template`, target: COMPOSE },
  ]);
  return parseYaml(readFileSync(join(out, COMPOSE), 'utf-8')) as Compose;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function envValue(env: string[] | undefined, key: string): string | undefined {
  const line = (env ?? []).find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1);
}

function namesOn(service: ComposeService | undefined, network: string): string[] {
  const networks = service?.networks;
  if (!networks || typeof networks !== 'object' || Array.isArray(networks)) return [];
  const entry = (networks as Record<string, { aliases?: string[] } | null>)[network];
  return entry?.aliases ?? [];
}

function declaredNetworks(service: ComposeService | undefined): string[] {
  const networks = service?.networks;
  if (Array.isArray(networks)) return [...networks].sort();
  if (networks && typeof networks === 'object') return Object.keys(networks).sort();
  return [];
}

function proxyHost(compose: Compose): string {
  const target = envValue(compose.services?.frontend?.environment, 'VITE_PROXY_TARGET');
  if (!target) throw new Error('VITE_PROXY_TARGET not set in rendered frontend environment');
  return new URL(target).hostname;
}

function traefikApiLabelHost(compose: Compose): string {
  const labels = compose.services?.server?.labels ?? [];
  const label = labels.find((l) => /^traefik\.http\.routers\.pan-api-.*\.rule=/.test(l));
  if (!label) throw new Error('No pan-api traefik router rule label found');
  const match = label.match(/Host\(`([^.`]+)\.overdeck\.localhost`\)/);
  if (!match) throw new Error(`Could not parse host from traefik label: ${label}`);
  return match[1] ?? '';
}

describe('devcontainer proxy target uniqueness', () => {
  it('never shares a proxy target between stacks', () => {
    const stacks = [
      render('pan-9001'),
      render('pan-9002'),
      render('alpha-bravo-1115', { FEATURE_FOLDER: 'uat-alpha-bravo-1115' }),
    ];

    const hosts = stacks.map(proxyHost);

    for (const [index, compose] of stacks.entries()) {
      const host = hosts[index] as string;
      const server = compose.services?.server;
      const frontend = compose.services?.frontend;

      // 1. The proxy host is declared as a devnet alias on this stack's server.
      expect(namesOn(server, 'devnet')).toContain(host);

      // 2. The proxy host is never the bare service name, and never an overdeck alias.
      expect(host).not.toBe('server');
      expect(namesOn(server, 'overdeck')).not.toContain(host);

      // 4. The proxy port matches the server's own PORT env value.
      const target = envValue(frontend?.environment, 'VITE_PROXY_TARGET');
      const serverPort = envValue(server?.environment, 'PORT');
      expect(target).toBeDefined();
      expect(serverPort).toBeDefined();
      expect(new URL(target as string).port).toBe(serverPort);

      // 5. The proxy host is a valid DNS label and matches the Traefik API host's first label.
      expect(host).toMatch(/^[a-z0-9-]{1,63}$/);
      expect(host).toBe(traefikApiLabelHost(compose));

      // 6. Network membership for server and frontend is unchanged: both on devnet + overdeck.
      expect(declaredNetworks(server)).toEqual(['devnet', 'overdeck']);
      expect(declaredNetworks(frontend)).toEqual(['devnet', 'overdeck']);

      // 3. No other stack's server exposes this host, on either network.
      for (const [otherIndex, otherCompose] of stacks.entries()) {
        if (otherIndex === index) continue;
        const otherServer = otherCompose.services?.server;
        expect(namesOn(otherServer, 'overdeck')).not.toContain(host);
        expect(namesOn(otherServer, 'devnet')).not.toContain(host);
      }
    }

    expect(new Set(hosts).size).toBe(hosts.length);
  });
});
