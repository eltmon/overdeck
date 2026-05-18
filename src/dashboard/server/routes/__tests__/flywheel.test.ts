import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveFlywheelBriefPath } from '../flywheel.js';

describe('resolveFlywheelBriefPath', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'pan-flywheel-brief-'));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('defaults to docs/flywheel-brief.md', () => {
    expect(resolveFlywheelBriefPath(projectRoot)).toEqual({
      ok: true,
      path: 'docs/flywheel-brief.md',
    });
  });

  it('accepts an absolute path inside the project root', () => {
    const path = resolve(projectRoot, 'docs/custom-brief.md');

    expect(resolveFlywheelBriefPath(projectRoot, path)).toEqual({
      ok: true,
      path: 'docs/custom-brief.md',
    });
  });

  it('rejects paths outside the project root', () => {
    const outside = resolve(projectRoot, '..', 'outside.md');

    expect(resolveFlywheelBriefPath(projectRoot, outside)).toEqual({
      ok: false,
      error: 'Brief path must stay inside the project root',
    });
  });
});
