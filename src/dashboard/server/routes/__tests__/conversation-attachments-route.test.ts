/**
 * PAN-4493 — GET /api/conversations/:name/attachments/:file.
 *
 * No module mocks: a real temp OVERDECK_HOME backs resolveConversationImageAttachment
 * end to end (regex validation, hasConversationAttachment realpath containment, stat).
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { conversationAttachmentRoutes } from '../conversation-attachments.js';

// Smallest valid 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

let previousOverdeckHome: string | undefined;
let tempHome: string;

beforeEach(async () => {
  previousOverdeckHome = process.env.OVERDECK_HOME;
  tempHome = await mkdtemp(join(tmpdir(), 'overdeck-attachments-route-'));
  process.env.OVERDECK_HOME = tempHome;

  const convADir = join(tempHome, 'conversation-attachments', 'conv-a');
  const convBDir = join(tempHome, 'conversation-attachments', 'conv-b');
  await mkdir(convADir, { recursive: true });
  await mkdir(convBDir, { recursive: true });
  await writeFile(join(convADir, 'a.png'), PNG_BYTES);
  await writeFile(join(convBDir, 'b.png'), PNG_BYTES);
  await writeFile(join(convADir, 'page.html'), '<html></html>');
  await writeFile(join(tempHome, 'outside.png'), PNG_BYTES);
  await symlink(join(tempHome, 'outside.png'), join(convADir, 'escape.png'));
});

afterEach(async () => {
  if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = previousOverdeckHome;
  await rm(tempHome, { recursive: true, force: true });
});

async function call(path: string, origin?: string | null) {
  const headers: Record<string, string> = {};
  if (origin !== undefined && origin !== null) headers.Origin = origin;
  const request = HttpServerRequest.fromWeb(new Request(`http://localhost${path}`, { method: 'GET', headers }));
  const response = await Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(
        HttpRouter.toHttpEffect(conversationAttachmentRoutes),
        (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
      ),
    ).pipe(Effect.catch(() => Effect.succeed({ status: 404 } as const))),
  );
  const typed = response as { status?: number; headers?: Record<string, string>; body?: { body?: Uint8Array } };
  return {
    status: typed.status ?? 200,
    headers: typed.headers ?? {},
    bytes: typed.body?.body,
  };
}

describe('GET /api/conversations/:name/attachments/:file', () => {
  it('returns the image with its content type for a file in the conversation folder', async () => {
    const res = await call('/api/conversations/conv-a/attachments/a.png');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.bytes ?? [])).toEqual(PNG_BYTES);
  });

  it("returns 404 for another conversation's file", async () => {
    const res = await call('/api/conversations/conv-a/attachments/b.png');
    expect(res.status).toBe(404);
  });

  it('returns 404 for encoded traversal', async () => {
    expect((await call('/api/conversations/conv-a/attachments/..%2Fconv-b%2Fb.png')).status).toBe(404);
    expect((await call('/api/conversations/conv-a/attachments/%2E%2E%2Fconv-b%2Fb.png')).status).toBe(404);
  });

  it('returns 404 for a non-image file in the folder', async () => {
    const res = await call('/api/conversations/conv-a/attachments/page.html');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a missing file and a bad conversation name', async () => {
    expect((await call('/api/conversations/conv-a/attachments/nope.png')).status).toBe(404);
    expect((await call('/api/conversations/bad.name/attachments/a.png')).status).toBe(404);
  });

  it('returns 404 for a symlink that escapes the folder', async () => {
    const res = await call('/api/conversations/conv-a/attachments/escape.png');
    expect(res.status).toBe(404);
  });

  it('returns 403 for an untrusted origin', async () => {
    const res = await call('/api/conversations/conv-a/attachments/a.png', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});
