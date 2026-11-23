/**
 * PAN-5489: the Hume API key is resolved at the moment of use, in order:
 * process env, the project's secrets_file, then a fresh read of ~/.overdeck.env.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHumeConfig, resolveHumeApiKey } from '../../../src/lib/hume.js';
import type { HumeConfig, TemplatePlaceholders } from '../../../src/lib/workspace-config.js';

const humeConfig: HumeConfig = {
  template_config_id: 'tmpl-1',
  name_pattern: 'kaia-{{FEATURE_FOLDER}}',
  byollm_url_pattern: 'https://x/{{FEATURE_FOLDER}}',
};

const placeholders = { FEATURE_FOLDER: 'feature-min-1' } as TemplatePlaceholders;

let root: string;
let home: string;
let projectPath: string;
let secretsPath: string;

function project() {
  return { key: 'myn', config: { path: projectPath, workspace: { env: { secrets_file: secretsPath } } } };
}

beforeEach(async () => {
  // The fake HOME and the fake project are siblings: readProjectSecrets ignores
  // a secrets file that lies inside the project path.
  root = await mkdtemp(join(tmpdir(), 'pan-5489-hume-'));
  home = join(root, 'home');
  projectPath = join(root, 'project');
  secretsPath = join(root, 'secrets', 'secrets.env');
  await mkdir(home, { recursive: true });
  await mkdir(projectPath, { recursive: true });
  await mkdir(join(root, 'secrets'), { recursive: true });
  vi.stubEnv('HOME', home);
  vi.stubEnv('HUME_API_KEY', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('resolveHumeApiKey (PAN-5489)', () => {
  it('uses the project secrets_file when the process env lacks the key, without writing process.env', async () => {
    await writeFile(secretsPath, 'HUME_API_KEY=key-from-secrets\n');

    const resolved = await resolveHumeApiKey(humeConfig, { project: project() });

    expect(resolved).toEqual({ apiKey: 'key-from-secrets', source: 'secrets-file' });
    expect(process.env.HUME_API_KEY).toBe('');
  });

  it('reads ~/.overdeck.env fresh, after module import', async () => {
    await writeFile(join(home, '.overdeck.env'), 'HUME_API_KEY=key-from-overdeck-env\n');

    const resolved = await resolveHumeApiKey(humeConfig, { project: project() });

    expect(resolved).toEqual({ apiKey: 'key-from-overdeck-env', source: 'overdeck-env' });
  });

  it('prefers the process env over both files', async () => {
    await writeFile(secretsPath, 'HUME_API_KEY=key-from-secrets\n');
    await writeFile(join(home, '.overdeck.env'), 'HUME_API_KEY=key-from-overdeck-env\n');
    vi.stubEnv('HUME_API_KEY', 'key-from-process');

    const resolved = await resolveHumeApiKey(humeConfig, { project: project() });

    expect(resolved).toEqual({ apiKey: 'key-from-process', source: 'process-env' });
  });

  it('prefers the secrets_file over ~/.overdeck.env', async () => {
    await writeFile(secretsPath, 'HUME_API_KEY=key-from-secrets\n');
    await writeFile(join(home, '.overdeck.env'), 'HUME_API_KEY=key-from-overdeck-env\n');

    const resolved = await resolveHumeApiKey(humeConfig, { project: project() });

    expect(resolved).toMatchObject({ source: 'secrets-file' });
  });

  it('honors a custom api_key_env', async () => {
    await writeFile(join(home, '.overdeck.env'), 'HUME_API_KEY=wrong\nMY_HUME_KEY=custom-key\n');

    const resolved = await resolveHumeApiKey({ ...humeConfig, api_key_env: 'MY_HUME_KEY' });

    expect(resolved).toEqual({ apiKey: 'custom-key', source: 'overdeck-env' });
  });
});

describe('createHumeConfig key lookup (PAN-5489)', () => {
  it('sends the secrets_file key on its first Hume request', async () => {
    await writeFile(secretsPath, 'HUME_API_KEY=key-from-secrets\n');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ configs_page: [{ id: 'cfg-9', name: 'kaia-feature-min-1' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createHumeConfig(humeConfig, placeholders, { project: project() });

    expect(result).toMatchObject({ success: true, configId: 'cfg-9' });
    const firstInit = fetchMock.mock.calls[0]?.[1];
    expect((firstInit?.headers as Record<string, string>)['X-Hume-Api-Key']).toBe('key-from-secrets');
    expect(process.env.HUME_API_KEY).toBe('');
  });

  it('names the env var and every checked source, and no value, when the key is absent', async () => {
    await writeFile(secretsPath, 'OTHER_SECRET=do-not-print-me\n');
    await writeFile(join(home, '.overdeck.env'), 'ANOTHER_SECRET=also-hidden\n');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await createHumeConfig(humeConfig, placeholders, { project: project() });

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(1);
    const [line] = result.steps;
    expect(line).toContain('[hume] API key not found');
    expect(line).toContain('HUME_API_KEY');
    expect(line).toContain(secretsPath);
    expect(line).toContain(join(home, '.overdeck.env'));
    expect(line).not.toContain('do-not-print-me');
    expect(line).not.toContain('also-hidden');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
