/**
 * Unit tests for readContextPercent() in work/status.ts (PAN-232)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

import { readContextPercent } from '../../src/cli/commands/status.js';
import { getPanopticonHome } from '../../src/lib/paths.js';

const AGENTS_DIR = join(getPanopticonHome(), 'agents');
const TEST_PREFIX = 'test-ctx-pan232';

function agentDir(id: string): string {
  return join(AGENTS_DIR, id);
}

function ctxFile(id: string): string {
  return join(agentDir(id), 'context-pct');
}

function cleanup(ids: string[]) {
  for (const id of ids) {
    const dir = agentDir(id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

describe('readContextPercent (PAN-232)', () => {
  const ids: string[] = [];

  function uniqueId(): string {
    const id = `${TEST_PREFIX}-${Date.now()}-${ids.length}`;
    ids.push(id);
    return id;
  }

  afterEach(() => {
    cleanup(ids);
    ids.length = 0;
  });

  it('returns the integer from a valid context-pct file', () => {
    const id = uniqueId();
    mkdirSync(agentDir(id), { recursive: true });
    writeFileSync(ctxFile(id), '47\n');
    expect(readContextPercent(id)).toBe(47);
  });

  it('returns null when context-pct contains non-numeric content', () => {
    const id = uniqueId();
    mkdirSync(agentDir(id), { recursive: true });
    writeFileSync(ctxFile(id), 'not-a-number');
    expect(readContextPercent(id)).toBeNull();
  });

  it('returns null when the context-pct file does not exist', () => {
    const id = uniqueId();
    mkdirSync(agentDir(id), { recursive: true });
    // No context-pct file written
    expect(readContextPercent(id)).toBeNull();
  });

  it('returns null when the agent directory does not exist at all', () => {
    const id = uniqueId();
    // Neither directory nor file exists
    expect(readContextPercent(id)).toBeNull();
  });
});
