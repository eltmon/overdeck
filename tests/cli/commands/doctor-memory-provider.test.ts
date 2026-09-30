import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMemoryExtraction } from '../../../src/cli/commands/doctor-memory-provider.js';
import type { MemoryHealthSnapshot } from '../../../src/lib/memory/health.js';

let memoryBase: string;

beforeEach(async () => {
  memoryBase = await mkdtemp(join(tmpdir(), 'pan-doctor-memory-provider-'));
});

afterEach(async () => {
  await rm(memoryBase, { recursive: true, force: true });
});

function snapshot(overrides: Partial<MemoryHealthSnapshot> = {}): MemoryHealthSnapshot {
  return {
    status: 'healthy',
    last_success: null,
    last_failure: null,
    last_failure_detail: null,
    last_failure_reason: null,
    extractions_attempted: 0,
    extractions_succeeded: 0,
    failed_by_reason: {},
    ...overrides,
  };
}

async function writeHealth(projectId: string, workspaceId: string, content: string): Promise<void> {
  const dir = join(memoryBase, projectId, workspaceId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'health.json'), content, 'utf8');
}

// PAN-4370 WI-7: pan doctor gets a Memory extraction row sourced from
// health.json evidence, not from probing the operator's own shell env.
describe('checkMemoryExtraction', () => {
  it('returns ok with no activity for an empty memory base (ac1)', async () => {
    const result = await checkMemoryExtraction({ memoryBase });

    expect(result).toEqual({ name: 'Memory extraction', status: 'ok', message: 'no memory extraction activity recorded' });
  });

  it('returns warn for the newest provider-auth-failed failure across workspaces, with a fix mentioning ANTHROPIC_API_KEY and PAN-4374 (ac2)', async () => {
    await writeHealth('overdeck', 'ws-older', JSON.stringify(snapshot({
      status: 'failing',
      last_failure: '2026-09-28T00:00:00.000Z',
      last_failure_reason: 'extraction-failed',
      last_failure_detail: 'cliproxy/gpt-4.1-nano: unknown provider',
    })));
    await writeHealth('overdeck', 'ws-newer', JSON.stringify(snapshot({
      status: 'failing',
      last_failure: '2026-09-29T00:00:00.000Z',
      last_failure_reason: 'provider-auth-failed',
      last_failure_detail: 'anthropic/claude-haiku-4-5: no ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN',
    })));

    const result = await checkMemoryExtraction({ memoryBase });

    expect(result.status).toBe('warn');
    expect(result.message).toContain('provider-auth-failed');
    expect(result.message).toContain('anthropic/claude-haiku-4-5: no ANTHROPIC_API_KEY');
    expect(result.message).toContain('overdeck/ws-newer');
    expect(result.fix).toContain('ANTHROPIC_API_KEY');
    expect(result.fix).toContain('PAN-4374');
  });

  it('returns ok when the newest event is a success, and skips a corrupt health.json instead of throwing (ac3)', async () => {
    await writeHealth('overdeck', 'ws-corrupt', '{not json');
    await writeHealth('overdeck', 'ws-ok', JSON.stringify(snapshot({
      status: 'healthy',
      last_success: '2026-09-29T12:00:00.000Z',
    })));

    const result = await checkMemoryExtraction({ memoryBase });

    expect(result).toEqual({ name: 'Memory extraction', status: 'ok', message: 'last success 2026-09-29T12:00:00.000Z (overdeck/ws-ok)' });
  });
});
