/** PAN-4482 WI-1: the shared share-Worker harness boots the bundled Worker on real workerd. */
import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { startShareWorker, tokenFor, type ShareWorker } from '../share-worker.js';

const SLOW = 180_000;
const OWNER = { id: 1, login: 'owner' };
const started: ShareWorker[] = [];

afterAll(async () => {
  await Promise.all(started.map((w) => w.dispose()));
}, 60_000);

async function start(options: Parameters<typeof startShareWorker>[0]): Promise<ShareWorker> {
  const worker = await startShareWorker(options);
  started.push(worker);
  return worker;
}

describe('startShareWorker (PAN-4482 WI-1)', () => {
  it('ac1: starts the bundled Worker with the account stub', async () => {
    const worker = await start({ users: [OWNER] });
    expect(worker.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const health = await fetch(`${worker.url}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, configured: true, turn: false });

    const created = (await worker.mf.dispatchFetch(`${worker.base}/v1/rooms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenFor(OWNER.id)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: { kind: 'conversation', conversationId: 'conv-1' } }),
    })) as unknown as Response;
    expect(created.status).toBe(201);
  }, SLOW);

  it('ac2: reports turn: true when TURN secrets are bound', async () => {
    const worker = await start({ users: [OWNER], turn: { keyId: 'k', apiToken: 't' } });
    const health = await fetch(`${worker.url}/healthz`);
    expect(await health.json()).toMatchObject({ ok: true, turn: true });
  }, SLOW);

  it('ac3: dispose() removes the temporary bundle directory', async () => {
    const worker = await startShareWorker({ users: [OWNER] });
    const { dir } = worker;
    expect(dir).toContain('overdeck-share-worker-');
    expect(existsSync(dir)).toBe(true);
    await worker.dispose();
    expect(existsSync(dir)).toBe(false);
  }, SLOW);
});
