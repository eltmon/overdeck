import { describe, expect, it } from 'vitest';
import { deleteDirectoryAccount, readDirectoryView, removeDirectoryMachine } from '../../../../services/account/src/directory-view.ts';
import type { DirectoryView } from '../../../../services/account/src/directory-view.ts';
import type { Env } from '../../../../services/account/src/env.ts';
import { makeEnv } from './helpers/harness.ts';

interface Seen {
  names: string[];
  requests: Array<{ url: string; method: string; body: string }>;
}

/** A fake DurableObjectNamespace whose stub answers every fetch with `answer`. */
function fakeDirectory(answer: (req: Request) => Response | Promise<Response>): { env: Env; seen: Seen } {
  const seen: Seen = { names: [], requests: [] };
  const namespace = {
    idFromName(name: string) {
      seen.names.push(name);
      return { name } as unknown as DurableObjectId;
    },
    get() {
      return {
        async fetch(input: RequestInfo, init?: RequestInit) {
          const req = new Request(input, init);
          seen.requests.push({ url: req.url, method: req.method, body: await req.text() });
          return answer(req);
        },
      } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
  return { env: makeEnv({ DIRECTORY: namespace }), seen };
}

const VIEW: DirectoryView = {
  machines: [
    { environmentId: 'env-1', label: 'desk', online: true, lastSeenAt: '2026-11-01T00:00:00.000Z', serverVersion: '0.72.0', deviceId: 'd-1' },
    { environmentId: 'env-2', label: 'laptop', online: false, lastSeenAt: '2026-11-02T00:00:00.000Z', serverVersion: '0.71.0', deviceId: 'd-2' },
  ],
  relay: { month: '2026-11', bytesUsed: 12_300_000_000, capBytes: 50_000_000_000, stopped: false },
};

describe('account-side Directory client (PAN-4959 WI-5)', () => {
  it('readDirectoryView returns null without a DIRECTORY binding', async () => {
    expect(await readDirectoryView(makeEnv(), 'u-1')).toBeNull();
  });

  it('readDirectoryView names the DO by user id, GETs /account-view and returns the parsed view', async () => {
    const { env, seen } = fakeDirectory(() => Response.json(VIEW));
    expect(await readDirectoryView(env, 'u-1')).toEqual(VIEW);
    expect(seen.names).toEqual(['u-1']);
    expect(seen.requests).toEqual([{ url: 'https://directory/account-view', method: 'GET', body: '' }]);
  });

  it('readDirectoryView returns null for a malformed body, a 500 or a throwing stub', async () => {
    const malformed = [{ machines: 'nope', relay: VIEW.relay }, { machines: [{ ...VIEW.machines[0], online: 'yes' }], relay: VIEW.relay }, { machines: [] }];
    for (const body of malformed) expect(await readDirectoryView(fakeDirectory(() => Response.json(body)).env, 'u-1')).toBeNull();
    expect(await readDirectoryView(fakeDirectory(() => new Response('not json')).env, 'u-1')).toBeNull();
    expect(await readDirectoryView(fakeDirectory(() => Response.json(VIEW, { status: 500 })).env, 'u-1')).toBeNull();
    expect(await readDirectoryView(fakeDirectory(() => { throw new Error('down'); }).env, 'u-1')).toBeNull();
  });

  it('removeDirectoryMachine POSTs the environment id and maps 200, 404, 500, a throw and no binding', async () => {
    const ok = fakeDirectory(() => Response.json({ removed: true }));
    expect(await removeDirectoryMachine(ok.env, 'u-1', 'env-1')).toBe('removed');
    expect(ok.seen.requests).toEqual([{ url: 'https://directory/remove-machine', method: 'POST', body: '{"environmentId":"env-1"}' }]);
    expect(await removeDirectoryMachine(fakeDirectory(() => Response.json({ error: 'unknown_machine' }, { status: 404 })).env, 'u-1', 'env-9')).toBe('unknown');
    expect(await removeDirectoryMachine(fakeDirectory(() => new Response(null, { status: 500 })).env, 'u-1', 'env-1')).toBe('unavailable');
    expect(await removeDirectoryMachine(fakeDirectory(() => { throw new Error('down'); }).env, 'u-1', 'env-1')).toBe('unavailable');
    expect(await removeDirectoryMachine(makeEnv(), 'u-1', 'env-1')).toBe('unavailable');
  });

  it('deleteDirectoryAccount POSTs /delete-account and rejects with the HTTP status on a non-200', async () => {
    const ok = fakeDirectory(() => Response.json({ deleted: true }));
    await expect(deleteDirectoryAccount(ok.env, 'u-1')).resolves.toBeUndefined();
    expect(ok.seen.requests).toEqual([{ url: 'https://directory/delete-account', method: 'POST', body: '' }]);
    await expect(deleteDirectoryAccount(fakeDirectory(() => new Response(null, { status: 500 })).env, 'u-1')).rejects.toThrow('directory delete failed: HTTP 500');
  });
});
