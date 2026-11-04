/**
 * PAN-4645 WI-1: GET /api/environment carries the machine public key, the link
 * protocol version and the `machineLinks` capability, keeps protocolVersion 1,
 * leaks no secret key, and answers 503 naming a corrupt key file.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Schema } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentDescriptor } from '@overdeck/contracts';

import { environmentRouteLayer } from '../routes/environment.js';

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
let home: string;

beforeEach(async () => {
  process.env.OVERDECK_INTERNAL_TOKEN = 'internal-token-must-not-leak-0123456789';
  home = await mkdtemp(join(tmpdir(), 'pan-4645-env-key-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  if (originalToken === undefined) delete process.env.OVERDECK_INTERNAL_TOKEN;
  else process.env.OVERDECK_INTERNAL_TOKEN = originalToken;
  await rm(home, { recursive: true, force: true });
});

describe('GET /api/environment machine key (PAN-4645)', () => {
  it('ac3: returns a 32-byte machineKey, linkProtocol 1 and machineLinks while protocolVersion stays 1', async () => {
    const res = await getEnvironment();
    expect(res.status).toBe(200);
    expect(() => Schema.decodeUnknownSync(EnvironmentDescriptor)(res.json)).not.toThrow();

    expect(res.json.machineKey).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(res.json.machineKey, 'hex').length).toBe(32);
    expect(res.json.linkProtocol).toBe(1);
    expect(res.json.capabilities.machineLinks).toBe(true);
    expect(res.json.protocolVersion).toBe(1);
    expect(res.json.descriptorVersion).toBe(1);
  });

  it('serves the same key on every call and never the secret half', async () => {
    const first = await getEnvironment();
    const second = await getEnvironment();
    expect(second.json.machineKey).toBe(first.json.machineKey);

    const path = join(home, 'machine-key.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(await readFile(path, 'utf8'));
    expect(stored.publicKey).toBe(first.json.machineKey);
    expect(stored.secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(first.text).not.toContain(stored.secretKey);
    expect(first.text).not.toContain('secretKey');
    expect(first.text).not.toContain(home);
  });

  it('answers 503 naming the key file when it is corrupt, and never re-mints it', async () => {
    const path = join(home, 'machine-key.json');
    await writeFile(path, '{not json', 'utf8');
    const res = await getEnvironment();
    expect(res.status).toBe(503);
    expect(res.json.error).toContain(path);
    expect(await readFile(path, 'utf8')).toBe('{not json');
  });
});
