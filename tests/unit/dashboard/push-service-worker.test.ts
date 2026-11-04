/**
 * PAN-2354: the one service worker (`/sw.js`) honors the push payload contract
 * shared with PAN-2355: `{ title, body, url, tag }`, same-origin urls only,
 * focus-and-navigate an open window before opening a new one.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SW_PATH = join(process.cwd(), 'src/dashboard/frontend/public/sw.js');
const ORIGIN = 'https://desk.example';

type Handler = (event: Record<string, unknown>) => void;

async function loadWorker(windows: Array<{ url: string; focus: () => Promise<void>; navigate: (url: string) => Promise<void> }> = []) {
  const listeners = new Map<string, Handler[]>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => null);
  const matchAll = vi.fn(async () => windows);
  const self = {
    addEventListener: (type: string, handler: Handler) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    skipWaiting: vi.fn(),
    registration: { showNotification },
    clients: { claim: vi.fn(async () => undefined), matchAll, openWindow },
    location: { origin: ORIGIN },
  };
  runInNewContext(await readFile(SW_PATH, 'utf8'), { self, URL, console });

  async function dispatch(type: string, event: Record<string, unknown>): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const handler of listeners.get(type) ?? []) {
      handler({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    }
    await Promise.all(pending);
  }

  return { listeners, showNotification, openWindow, matchAll, dispatch };
}

function pushEvent(payload: unknown) {
  return { data: { json: () => payload } };
}

function clickEvent(url: string) {
  return { notification: { close: vi.fn(), data: { url } } };
}

describe('push service worker (PAN-2354)', () => {
  it('registers exactly one push listener', async () => {
    const { listeners } = await loadWorker();
    expect(listeners.get('push')).toHaveLength(1);
    expect(listeners.get('notificationclick')).toHaveLength(1);
    expect(listeners.has('fetch')).toBe(false);
  });

  it('shows the notification with its tag and data.url', async () => {
    const worker = await loadWorker();
    await worker.dispatch('push', pushEvent({ title: 'Question · x', body: 'Tap to answer.', url: '/m?subject=x', tag: 'auq:1' }));
    expect(worker.showNotification).toHaveBeenCalledWith('Question · x', expect.objectContaining({
      body: 'Tap to answer.',
      tag: 'auq:1',
      data: { url: '/m?subject=x' },
    }));
  });

  it('falls back to a generic notification for an unreadable payload', async () => {
    const worker = await loadWorker();
    await worker.dispatch('push', { data: { json: () => { throw new Error('bad'); } } });
    expect(worker.showNotification).toHaveBeenCalledWith('Overdeck', expect.objectContaining({ body: 'Something needs you.', data: { url: '/m' } }));
  });

  it('opens /m instead of a cross-origin url', async () => {
    const worker = await loadWorker();
    await worker.dispatch('notificationclick', clickEvent('https://evil.example/x'));
    expect(worker.openWindow).toHaveBeenCalledWith(`${ORIGIN}/m`);
  });

  it('opens a new window when no dashboard window is open', async () => {
    const worker = await loadWorker();
    await worker.dispatch('notificationclick', clickEvent('/m?subject=x'));
    expect(worker.openWindow).toHaveBeenCalledWith(`${ORIGIN}/m?subject=x`);
  });

  it('focuses and navigates an open same-origin window', async () => {
    const client = { url: `${ORIGIN}/`, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) };
    const worker = await loadWorker([{ url: 'https://other.example/', focus: vi.fn(), navigate: vi.fn() }, client]);
    await worker.dispatch('notificationclick', clickEvent('/m?subject=x'));
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/m?subject=x`);
    expect(worker.openWindow).not.toHaveBeenCalled();
  });
});
