import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TELEMETRY_EVENT_CATALOG,
  TELEMETRY_EVENT_NAMES,
  TELEMETRY_PROPERTY_DOMAINS,
} from '@overdeck/contracts';

const repoRoot = join(import.meta.dirname, '..', '..');
const telemetryDocPath = join(repoRoot, 'docs', 'TELEMETRY.md');

type Catalog = Record<string, Record<string, string>>;
type Domains = Record<string, string[]>;

function documentedCatalog(markdown: string): Catalog {
  const catalog: Catalog = {};
  for (const match of markdown.matchAll(/^\| `([a-z_]+)` \| `([^`]*=[^`]*)` \|/gm)) {
    const properties = Object.fromEntries(
      match[2]!.split('; ').map((entry) => entry.split('=', 2) as [string, string]),
    );
    catalog[match[1]!] = properties;
  }
  return catalog;
}

function documentedDomains(markdown: string): Domains {
  const domains: Domains = {};
  for (const match of markdown.matchAll(/^\| `([a-z_]+)` \| ((?:`[^`]+`(?:, )?)+) \|$/gm)) {
    domains[match[1]!] = [...match[2]!.matchAll(/`([^`]+)`/g)].map((value) => value[1]!);
  }
  return domains;
}

function runtimeCatalog(): Catalog {
  return Object.fromEntries(
    Object.entries(TELEMETRY_EVENT_CATALOG).map(([event, properties]) => [
      event,
      { ...properties },
    ]),
  );
}

function runtimeDomains(): Domains {
  return Object.fromEntries(
    Object.entries(TELEMETRY_PROPERTY_DOMAINS).map(([domain, values]) => [
      domain,
      values.map(String),
    ]),
  );
}

function catalogDrift(markdown: string): {
  events: Catalog;
  domains: Domains;
} {
  return {
    events: documentedCatalog(markdown),
    domains: documentedDomains(markdown),
  };
}

describe('telemetry documentation', () => {
  const markdown = readFileSync(telemetryDocPath, 'utf8');

  it('keeps every event, property, and allowed value domain in exact contract sync', () => {
    expect(catalogDrift(markdown)).toEqual({
      events: runtimeCatalog(),
      domains: runtimeDomains(),
    });
    expect(Object.keys(documentedCatalog(markdown))).toHaveLength(TELEMETRY_EVENT_NAMES.length);
  });

  it('detects a contract event removed from the documentation', () => {
    const withoutServerBoot = markdown.replace(/^\| `server_boot` \|.*\n/m, '');

    expect(documentedCatalog(withoutServerBoot)).not.toEqual(runtimeCatalog());
    expect(documentedCatalog(withoutServerBoot)).not.toHaveProperty('server_boot');
  });

  it('detects property drift while the event name remains unchanged', () => {
    const changedProperty = markdown.replace(
      '`mode=project_mode` | The project wizard',
      '`source=project_mode` | The project wizard',
    );

    expect(documentedCatalog(changedProperty)).toHaveProperty('project_created');
    expect(documentedCatalog(changedProperty)).not.toEqual(runtimeCatalog());
  });

  it('detects allowed-value drift while properties and events remain unchanged', () => {
    const changedDomain = markdown.replace(
      '| `project_mode` | `existing`, `new` |',
      '| `project_mode` | `existing`, `new`, `imported` |',
    );

    expect(documentedCatalog(changedDomain)).toEqual(runtimeCatalog());
    expect(documentedDomains(changedDomain)).not.toEqual(runtimeDomains());
  });

  it('registers the telemetry and agent-reference pages in Mintlify navigation', () => {
    const docsConfig = JSON.parse(readFileSync(join(repoRoot, 'docs.json'), 'utf8')) as unknown;
    const serialized = JSON.stringify(docsConfig);

    expect(serialized).toContain('configuration/telemetry');
    expect(serialized).toContain('reference/posthog-agents');
    expect(() => readFileSync(join(repoRoot, 'configuration', 'telemetry.mdx'), 'utf8')).not.toThrow();
    expect(() => readFileSync(join(repoRoot, 'reference', 'posthog-agents.mdx'), 'utf8')).not.toThrow();
  });
});
