/**
 * PAN-3762 W1.2: GET /api/environment serves the public descriptor from the
 * stable machine identity, leaks nothing private, and answers 503 on a corrupt
 * identity file instead of re-minting it.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Schema } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentDescriptor } from '@overdeck/contracts';

import { environmentRouteLayer } from '../routes/environment.js';

const INTERNAL_TOKEN = 'internal-token-must-not-leak-0123456789';

async function getEnvironment() {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/environment'));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(environmentRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, text, json: JSON.parse(text) };
}

const originalHome = process.env.OVERDECK_HOME;
const originalToken = process.env.OVERDECK_INTERNAL_TOKEN;
const homes: string[] = [];

async function useFreshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'pan-3762-env-'));
  homes.push(home);
  process.env.OVERDECK_HOME = home;
  return home;
}

beforeEach(() => {
  process.env.OVERDECK_INTERNAL_TOKEN = INTERNAL_TOKEN;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (originalToken === undefined) delete process.env.OVERDECK_INTERNAL_TOKEN;
  else process.env.OVERDECK_INTERNAL_TOKEN = originalToken;
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('GET /api/environment (PAN-3762)', () => {
  it('returns a schema-valid descriptor whose id is stable per home and distinct across homes', async () => {
    await useFreshHome();
    const a1 = await getEnvironment();
    const a2 = await getEnvironment();
    await useFreshHome();
    const b1 = await getEnvironment();
    const b2 = await getEnvironment();

    for (const res of [a1, a2, b1, b2]) {
      expect(res.status).toBe(200);
      expect(() => Schema.decodeUnknownSync(EnvironmentDescriptor)(res.json)).not.toThrow();
    }
    expect(a1.json.environmentId).toBe(a2.json.environmentId);
    expect(b1.json.environmentId).toBe(b2.json.environmentId);
    expect(a1.json.environmentId).not.toBe(b1.json.environmentId);
  });

  it('contains no server path, home path, or internal token', async () => {
    const home = await useFreshHome();
    const res = await getEnvironment();
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('serverPath');
    expect(res.text).not.toContain(home);
    expect(res.text).not.toContain(INTERNAL_TOKEN);
  });

  it('answers 503 naming the file when the identity file is corrupt, and never re-mints it', async () => {
    const home = await useFreshHome();
    const path = join(home, 'environment-id.json');
    await writeFile(path, '{not json', 'utf8');
    const res = await getEnvironment();
    expect(res.status).toBe(503);
    expect(res.json.error).toContain(path);
    expect(await readFile(path, 'utf8')).toBe('{not json');
  });
});
