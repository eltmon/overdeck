/**
 * Unit-test harness for the account service (PRD PAN-4293 D-24).
 *
 * Tests drive handle() directly with an Env, a fake ExecutionContext and injected Deps.
 * Nothing here imports services/account/src/index.ts (the cloudflare:workers importer).
 * env.DB is the node:sqlite D1 shim from ./d1.ts with the migrations applied.
 */
import type { Deps, Env, RequestContext } from '../../../../../services/account/src/env.ts';
import { parseConfig } from '../../../../../services/account/src/env.ts';
import { handle } from '../../../../../services/account/src/routes.ts';
import { applyMigrations, createTestD1, type D1Shim } from './d1.ts';

export const TEST_BASE_URL = 'https://account.test';
export const TEST_OWNER_GITHUB_ID = 1;

/** A fresh in-memory D1 with every migration applied. */
export function makeDb(): D1Shim {
  const db = createTestD1();
  applyMigrations(db);
  return db;
}

/** The shim behind env.DB, for direct SQL in tests. */
export function dbOf(env: Env): D1Shim {
  return env.DB as unknown as D1Shim;
}

/** Fully configured Env with a fresh migrated database. Pass `undefined` for a key to simulate an unset secret. */
export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: makeDb() as unknown as D1Database,
    PUBLIC_BASE_URL: TEST_BASE_URL,
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    OWNER_GITHUB_ID: String(TEST_OWNER_GITHUB_ID),
    ...overrides,
  };
}

export interface FakeCtx extends ExecutionContext {
  /** Awaits every promise handed to waitUntil(), in order. */
  drain(): Promise<void>;
  readonly pending: readonly Promise<unknown>[];
}

export function fakeCtx(): FakeCtx {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    exports: {} as ExecutionContext['exports'],
    props: {},
    async drain() {
      while (pending.length > 0) {
        const batch = pending.splice(0, pending.length);
        await Promise.all(batch);
      }
    },
  };
}

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface TestDeps extends Deps {
  clock: { now: number; advance(ms: number): void; set(ms: number): void };
  fetchCalls: FetchCall[];
}

export interface MakeDepsOptions {
  now?: number;
  /** Outbound HTTP mock. The default throws so no test reaches GitHub or anything else. */
  fetch?: typeof fetch;
}

export function makeDeps(opts: MakeDepsOptions = {}): TestDeps {
  const clock = {
    now: opts.now ?? Date.UTC(2026, 9, 1, 12, 0, 0),
    advance(ms: number) {
      clock.now += ms;
    },
    set(ms: number) {
      clock.now = ms;
    },
  };
  const fetchCalls: FetchCall[] = [];
  const inner: typeof fetch =
    opts.fetch ??
    (async (input) => {
      throw new Error(`unexpected outbound fetch: ${String(input instanceof Request ? input.url : input)}`);
    });
  const deps: TestDeps = {
    clock,
    fetchCalls,
    now: () => clock.now,
    fetch: (input, init) => {
      fetchCalls.push({ url: input instanceof Request ? input.url : String(input), init });
      return inner(input, init);
    },
  };
  return deps;
}

export interface CallOptions {
  env?: Env;
  deps?: Deps;
  ctx?: FakeCtx;
  /** Sent as CF-Connecting-IP. */
  ip?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

/** Dispatches one request through handle() against TEST_BASE_URL. */
export async function call(method: string, path: string, opts: CallOptions = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (opts.ip) headers.set('CF-Connecting-IP', opts.ip);
  const req = new Request(`${TEST_BASE_URL}${path}`, { method, headers, body: opts.body ?? null });
  return handle(req, opts.env ?? makeEnv(), opts.ctx ?? fakeCtx(), opts.deps ?? makeDeps());
}

export interface RcOptions {
  env?: Env;
  deps?: Deps;
  ctx?: FakeCtx;
  params?: Record<string, string>;
  clientIp?: string;
}

/** A RequestContext for calling module functions directly, bypassing the route table. */
export function makeRc(opts: RcOptions = {}): RequestContext {
  const env = opts.env ?? makeEnv();
  const parsed = parseConfig(env);
  if (!parsed.ok) throw new Error(`makeRc: env is missing ${parsed.missing.join(', ')}`);
  return {
    env,
    config: parsed.config,
    ctx: opts.ctx ?? fakeCtx(),
    deps: opts.deps ?? makeDeps(),
    params: opts.params ?? {},
    clientIp: opts.clientIp ?? '203.0.113.7',
  };
}

/** Builds a form body for POST /oauth/token and the HTML forms. */
export function form(fields: Record<string, string>): { body: string; headers: Record<string, string> } {
  return {
    body: new URLSearchParams(fields).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  };
}
