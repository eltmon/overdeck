import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/paths.js', () => ({ getOverdeckHome: () => '/tmp/overdeck-prime-context' }));

describe('Prime Agent context artifact', () => {
  it('uses an Overdeck-owned path outside ~/.prime/agent', async () => {
    const { primeAgentGlobalContextFile } = await import('../../../../src/lib/context-layers/layers.js');
    const path = primeAgentGlobalContextFile();
    expect(path).toBe('/tmp/overdeck-prime-context/context/prime-agent-global.md');
    expect(path).not.toContain('/.prime/agent');
  });
});
