import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ANTIGRAVITY_AUTH_METHODS,
  ANTIGRAVITY_AUTH_REQUIRED,
  AntigravityCredentialError,
  antigravityGeminiDir,
  readAntigravityAuthStatus,
  resolveAntigravityCredential,
  type AntigravityAuthDeps,
} from '../../../src/lib/antigravity-auth.js';

const TEST_KEY = 'test-gemini-key';

let root: string;
let home: string;
let geminiDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'antigravity-auth-'));
  home = join(root, 'home');
  geminiDir = join(root, 'gemini');
  await mkdir(home, { recursive: true });
  await mkdir(geminiDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function deps(overrides: { env?: NodeJS.ProcessEnv; google?: string } = {}): AntigravityAuthDeps {
  return {
    env: overrides.env ?? {},
    loadApiKeys: async () => (overrides.google === undefined ? {} : { google: overrides.google }),
    geminiDir,
    home,
  };
}

async function writeAdc(): Promise<string> {
  const dir = join(home, '.config', 'gcloud');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'application_default_credentials.json');
  await writeFile(path, '{"type":"authorized_user"}');
  return path;
}

async function writeGcpSettings(gcp: Record<string, unknown>): Promise<void> {
  await mkdir(join(geminiDir, 'antigravity-cli'), { recursive: true });
  await writeFile(join(geminiDir, 'antigravity-cli', 'settings.json'), JSON.stringify({ gcp }));
}

describe('resolveAntigravityCredential (PAN-5587 D4)', () => {
  it('uses the Overdeck settings key as gemini-api-key', async () => {
    await expect(resolveAntigravityCredential(deps({ google: TEST_KEY }))).resolves.toEqual({
      method: 'gemini-api-key',
      env: { GEMINI_API_KEY: TEST_KEY },
      source: 'settings',
    });
  });

  it('never reads GEMINI_API_KEY from the environment', async () => {
    await expect(resolveAntigravityCredential(deps({ env: { GEMINI_API_KEY: TEST_KEY } })))
      .rejects.toThrow(ANTIGRAVITY_AUTH_REQUIRED);
  });

  it('rejects a settings value that is still an unresolved env reference', async () => {
    const promise = resolveAntigravityCredential(deps({ google: '$GEMINI_API_KEY' }));
    await expect(promise).rejects.toBeInstanceOf(AntigravityCredentialError);
    await expect(resolveAntigravityCredential(deps({ google: '$GEMINI_API_KEY' })))
      .rejects.toThrow('environment reference ($GEMINI_API_KEY) that agent panes do not receive. Put the literal key in Settings → Google.');
  });

  it('prefers a settings key over a complete Agent Platform setup', async () => {
    await writeAdc();
    const credential = await resolveAntigravityCredential(deps({
      google: TEST_KEY,
      env: { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_LOCATION: 'us-central1' },
    }));
    expect(credential.method).toBe('gemini-api-key');
  });

  it('resolves Agent Platform from env and the default ADC file', async () => {
    await writeAdc();
    await expect(resolveAntigravityCredential(deps({
      env: { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_LOCATION: 'us-central1' },
    }))).resolves.toEqual({
      method: 'agent-platform',
      env: { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_LOCATION: 'us-central1' },
      source: 'agent-platform',
    });
  });

  it('resolves Agent Platform from settings.json and an ADC file named by GOOGLE_APPLICATION_CREDENTIALS', async () => {
    await writeGcpSettings({ project: 'test-project', location: 'us-central1' });
    const adc = join(root, 'adc.json');
    await writeFile(adc, '{}');
    await expect(resolveAntigravityCredential(deps({ env: { GOOGLE_APPLICATION_CREDENTIALS: adc } }))).resolves.toEqual({
      method: 'agent-platform',
      env: {},
      source: 'agent-platform',
    });
  });

  it('requires an ADC file for Agent Platform', async () => {
    await expect(resolveAntigravityCredential(deps({
      env: { GOOGLE_CLOUD_PROJECT: 'test-project', GOOGLE_CLOUD_LOCATION: 'us-central1' },
    }))).rejects.toThrow(ANTIGRAVITY_AUTH_REQUIRED);
  });

  it('ignores an unparseable settings.json', async () => {
    await writeAdc();
    await mkdir(join(geminiDir, 'antigravity-cli'), { recursive: true });
    await writeFile(join(geminiDir, 'antigravity-cli', 'settings.json'), '{not json');
    await expect(resolveAntigravityCredential(deps())).rejects.toThrow(ANTIGRAVITY_AUTH_REQUIRED);
  });

  it('fails with the clause 6 reason when no credential exists', async () => {
    const error = await resolveAntigravityCredential(deps()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AntigravityCredentialError);
    expect((error as Error).message).toBe(ANTIGRAVITY_AUTH_REQUIRED);
    expect((error as Error).message).toContain('clause 6');
  });

  it('never puts the key value in a thrown message', async () => {
    const missing = await resolveAntigravityCredential(deps({ env: { GEMINI_API_KEY: TEST_KEY } }))
      .catch((caught: unknown) => caught as Error);
    expect(missing).toBeInstanceOf(AntigravityCredentialError);
    expect((missing as Error).message).not.toContain(TEST_KEY);
    const reference = await resolveAntigravityCredential(deps({ google: '${GEMINI_API_KEY}', env: { GEMINI_API_KEY: TEST_KEY } }))
      .catch((caught: unknown) => caught as Error);
    expect(reference).toBeInstanceOf(AntigravityCredentialError);
    expect((reference as Error).message).not.toContain(TEST_KEY);
  });
});

describe('readAntigravityAuthStatus', () => {
  it('reports not ready when no credential exists', async () => {
    await expect(readAntigravityAuthStatus(deps())).resolves.toEqual({ ready: false, method: null });
  });

  it('reports the resolved method when ready', async () => {
    await expect(readAntigravityAuthStatus(deps({ google: TEST_KEY }))).resolves.toEqual({ ready: true, method: 'gemini-api-key' });
  });

  it('rethrows errors other than a missing credential', async () => {
    const failing: AntigravityAuthDeps = { ...deps(), loadApiKeys: async () => { throw new Error('config unreadable'); } };
    await expect(readAntigravityAuthStatus(failing)).rejects.toThrow('config unreadable');
  });
});

describe('ANTIGRAVITY_AUTH_METHODS (PAN-5587 D3)', () => {
  it('offers only the API key and Agent Platform methods, never an OAuth method', () => {
    expect([...ANTIGRAVITY_AUTH_METHODS]).toEqual(['gemini-api-key', 'agent-platform']);
  });
});

describe('antigravityGeminiDir (PAN-5587 D6)', () => {
  it('is <OVERDECK_HOME>/antigravity', () => {
    expect(antigravityGeminiDir('/x/.overdeck')).toBe('/x/.overdeck/antigravity');
  });
});
