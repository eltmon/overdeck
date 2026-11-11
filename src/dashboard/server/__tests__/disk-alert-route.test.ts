/**
 * PAN-5093: `GET /api/disk-alert` serves the disk-alert service's snapshot,
 * and the route is scoped `read:state` for paired phones.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';
import type { DiskAlertSnapshot } from '@overdeck/contracts';

const SNAPSHOT: DiskAlertSnapshot = {
  level: 'warning',
  path: '/home/op/.overdeck',
  availableBytes: 4.1 * 1024 ** 3,
  totalBytes: 100 * 1024 ** 3,
  warningBytes: 5 * 1024 ** 3,
  criticalBytes: 2 * 1024 ** 3,
  since: '2026-11-06T17:00:00.000Z',
  checkedAt: '2026-11-06T17:00:30.000Z',
  measuring: false,
  holders: null,
};

vi.mock('../services/disk-alert-service.js', () => ({
  getDiskAlertSnapshot: vi.fn(() => SNAPSHOT),
}));

import { diskAlertRouteLayer } from '../routes/disk-alert.js';
import { requiredScopeFor } from '../route-scopes.js';

async function getDiskAlert() {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/disk-alert'));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(diskAlertRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: JSON.parse(text) };
}

describe('GET /api/disk-alert (PAN-5093)', () => {
  it('returns 200 with the snapshot the disk alert service holds', async () => {
    const res = await getDiskAlert();
    expect(res.status).toBe(200);
    expect(res.json).toEqual(SNAPSHOT);
  });

  it('is scoped read:state, so a paired phone with read:state is accepted', () => {
    expect(requiredScopeFor('GET', '/api/disk-alert')).toBe('read:state');
  });
});
