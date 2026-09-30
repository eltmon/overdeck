import { describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:os')>(),
  platform: () => 'darwin' as const,
}));

const { readCpuPsi } = await import('../cpu-psi.js');

describe('readCpuPsi off Linux (PAN-4311 NFR-5)', () => {
  it('returns null fields without reading /proc', async () => {
    await expect(readCpuPsi()).resolves.toEqual({ someAvg10: null, someAvg60: null });
  });
});
