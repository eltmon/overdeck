import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempRoot: string | undefined;

async function importCvWithAgentsDir(agentsDir: string) {
  vi.resetModules();
  vi.doMock('../../../src/lib/paths.js', () => ({
    AGENTS_DIR: agentsDir,
  }));

  return import('../../../src/lib/cv.js');
}

describe('cv', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/lib/paths.js');
    vi.resetModules();

    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it('readAgentCVSync returns null without creating a missing agents directory', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pan-2208-cv-'));
    const agentsDir = join(tempRoot, 'home', 'agents');
    const { readAgentCVSync } = await importCvWithAgentsDir(agentsDir);

    expect(readAgentCVSync('agent-min-846')).toBeNull();
    expect(existsSync(agentsDir)).toBe(false);
  });
});
