import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildContextLayerState, saveContextLayer } from '../context.js';

// Backend coverage for PAN-1448: the dashboard Context tab saves the global
// layer through saveContextLayer, which must land the content on disk. The
// frontend test mocks fetch, so this verifies the actual file write.

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-context-route-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('saveContextLayer (global layer)', () => {
  const globalFile = () => join(home, 'context', 'global.md');

  it('writes the edited content to disk and reports the saved layer', async () => {
    const content = '# Global rules\n\nAlways use absolute paths.\n';
    const response = await saveContextLayer([], { kind: 'global' }, content, home);

    expect(response.operation).toBe('save');
    expect(response.layer.kind).toBe('global');
    expect(response.layer.exists).toBe(true);
    expect(response.savedAt).toBeTruthy();

    const onDisk = await readFile(globalFile(), 'utf-8');
    expect(onDisk).toBe(content);
  });

  it('round-trips through buildContextLayerState — the saved content reloads', async () => {
    const content = '# Global rules\n\nPrefer composition over inheritance.\n';
    await saveContextLayer([], { kind: 'global' }, content, home);

    const state = await buildContextLayerState([], home);
    const globalLayer = state.layers.find((layer) => layer.kind === 'global');
    expect(globalLayer).toBeTruthy();
    expect(globalLayer?.exists).toBe(true);
    expect(globalLayer?.content).toBe(content);
  });

  it('overwrites an existing layer file in place', async () => {
    await saveContextLayer([], { kind: 'global' }, 'first version with enough characters', home);
    await saveContextLayer([], { kind: 'global' }, 'second version that replaces it', home);

    const onDisk = await readFile(globalFile(), 'utf-8');
    expect(onDisk).toBe('second version that replaces it');
  });

  it('leaves no temp files behind after an atomic write', async () => {
    await saveContextLayer([], { kind: 'global' }, 'content for the atomic-write check', home);

    const entries = await readdir(join(home, 'context'));
    expect(entries).toContain('global.md');
    expect(entries.filter((name) => name.endsWith('.tmp'))).toHaveLength(0);
  });
});
