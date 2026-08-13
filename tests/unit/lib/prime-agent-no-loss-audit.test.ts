import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const ALL = ['claude-code', 'ohmypi', 'codex', 'acp', 'kimi-code', 'prime-agent'];

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('Prime Agent no-loss audit', () => {
  it('has no unverified inventory row', () => {
    const rows = source('docs/prime-agent-no-loss-audit.md').split('\n').filter(line => /^\| S\d+/.test(line));
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter(row => !row.endsWith('| [x] |'))).toEqual([]);
  });

  it.each([
    'packages/contracts/src/types.ts',
    'packages/contracts/src/harness-behavior.ts',
    'src/lib/config-yaml/schema.ts',
    'src/lib/runtimes/types.ts',
    'src/lib/launcher-generator.ts',
  ])('%s preserves every harness literal', (path) => {
    const content = source(path);
    for (const harness of ALL) expect(content, `${path} omitted ${harness}`).toMatch(new RegExp(`["']${harness}["']`));
  });

  it.each([
    'packages/contracts/src/artifacts.ts',
    'packages/contracts/src/telemetry.ts',
    'packages/contracts/src/flywheel.ts',
    'packages/contracts/src/context-layers.ts',
  ])('%s includes Prime in its canonical enumeration', (path) => {
    expect(source(path)).toContain('prime-agent');
  });

  it('registers explicit runtime, transcript, cost, and frontend homes', () => {
    expect(source('src/lib/runtimes/index.ts')).toContain("register(createPrimeAgentRuntimeSync())");
    expect(source('src/lib/conversations/transcript-adapter.ts')).toContain("'prime-agent': primeAgentAdapter");
    expect(source('src/lib/overdeck/cost.ts')).toContain("'prime_agent'");
    expect(source('src/dashboard/frontend/src/components/shared/ModelPicker/ModelPicker.tsx')).toContain("id: 'prime-agent'");
  });
});
