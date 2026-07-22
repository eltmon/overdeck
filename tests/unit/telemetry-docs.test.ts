import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TELEMETRY_EVENT_NAMES } from '@overdeck/contracts';

const repoRoot = join(import.meta.dirname, '..', '..');
const telemetryDocPath = join(repoRoot, 'docs', 'TELEMETRY.md');

function documentedEvents(markdown: string): string[] {
  return [...markdown.matchAll(/^\| `([a-z_]+)` \|/gm)]
    .map((match) => match[1]!)
    .sort();
}

function eventDrift(markdown: string): { missing: string[]; extra: string[] } {
  const contract = new Set<string>(TELEMETRY_EVENT_NAMES);
  const documented = new Set(documentedEvents(markdown));
  return {
    missing: [...contract].filter((event) => !documented.has(event)).sort(),
    extra: [...documented].filter((event) => !contract.has(event)).sort(),
  };
}

describe('telemetry documentation', () => {
  const markdown = readFileSync(telemetryDocPath, 'utf8');

  it('keeps the documented event table in exact sync with contracts', () => {
    expect(eventDrift(markdown)).toEqual({ missing: [], extra: [] });
    expect(documentedEvents(markdown)).toHaveLength(TELEMETRY_EVENT_NAMES.length);
  });

  it('detects a contract event removed from the documentation', () => {
    const withoutServerBoot = markdown.replace(/^\| `server_boot` \|.*\n/m, '');

    expect(eventDrift(withoutServerBoot)).toEqual({
      missing: ['server_boot'],
      extra: [],
    });
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
