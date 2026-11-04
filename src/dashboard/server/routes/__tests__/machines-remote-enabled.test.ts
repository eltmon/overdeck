/** PAN-4905: GET /api/machines reports self.remoteEnabled from config.toml [remote] enabled. */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));

const { CONFIG_FILE } = await import('../../../../lib/paths.js');
const { buildMachinesResponse } = await import('../machines.js');

let previousConfig: string | null;

beforeEach(async () => {
  try {
    previousConfig = await readFile(CONFIG_FILE, 'utf8');
  } catch {
    previousConfig = null;
  }
});

afterEach(async () => {
  if (previousConfig === null) await rm(CONFIG_FILE, { force: true });
  else await writeFile(CONFIG_FILE, previousConfig, 'utf8');
});

describe('buildMachinesResponse self.remoteEnabled (PAN-4905)', () => {
  it('reports false and the display path when config.toml lacks [remote] enabled', async () => {
    await rm(CONFIG_FILE, { force: true });
    const response = (await buildMachinesResponse()) as { self: { remoteEnabled?: boolean; remoteConfigFile?: string } };
    expect(response.self.remoteEnabled).toBe(false);
    expect(response.self.remoteConfigFile).toMatch(/config\.toml$/);
  });

  it('reports true when config.toml has [remote] enabled = true', async () => {
    await writeFile(CONFIG_FILE, '[remote]\nenabled = true\n', 'utf8');
    const response = (await buildMachinesResponse()) as { self: { remoteEnabled?: boolean } };
    expect(response.self.remoteEnabled).toBe(true);
  });
});
