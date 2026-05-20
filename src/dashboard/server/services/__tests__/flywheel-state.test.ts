import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFlywheelState } from '../flywheel-state.js';

describe('readFlywheelState', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'pan-flywheel-state-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('reports the file as absent before the orchestrator writes it', async () => {
    const payload = await readFlywheelState({ projectRoot });

    expect(payload.exists).toBe(false);
    expect(payload.content).toBeNull();
    expect(payload.lastModified).toBeNull();
    expect(payload.path).toBe('docs/FLYWHEEL-STATE.md');
  });

  it('returns the markdown body and a modified timestamp when the file exists', async () => {
    await mkdir(join(projectRoot, 'docs'), { recursive: true });
    await writeFile(join(projectRoot, 'docs', 'FLYWHEEL-STATE.md'), '# State\n\nObservation 1.\n', 'utf8');

    const payload = await readFlywheelState({ projectRoot });

    expect(payload.exists).toBe(true);
    expect(payload.content).toBe('# State\n\nObservation 1.\n');
    expect(payload.path).toBe('docs/FLYWHEEL-STATE.md');
    expect(payload.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
