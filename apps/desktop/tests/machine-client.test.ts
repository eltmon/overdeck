/**
 * Unit tests for the chosen-machine HTTP client (PAN-4402 W-3).
 *
 * `fetchImpl` is a vi.fn router keyed by method and path; the store module is
 * mocked, so no test touches the network or disk.
 */

import * as OS from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock the store before importing the client ───────────────────────────────

const store = vi.hoisted(() => ({
  credentialStoreStatus: vi.fn((): { ok: true } | { ok: false; error: string } => ({ ok: true })),
  loadMachineRecord: vi.fn(),
  readMachineToken: vi.fn(),
  saveMachineRecord: vi.fn(),
}));

vi.mock("../src/machine-store.js", () => store);

import {
  type MachineClientDeps,
  STORE_DECRYPT_ERROR,
  pairWithMachine,
  preflightMachine,
  revokeOwnDevice,
} from "../src/machine-client.js";
import type { MachineRecord } from "../src/machine-store.js";

const BASE = "http://100.101.102.103:3011";
const ENV_ID = "env-desk";
const TOKEN = "odk_device_token";
const LINK = `${BASE}/#pair=odp_onetime`;

const RECORD: MachineRecord = {
  version: 1,
  active: true,
  baseUrl: BASE,
  environmentId: ENV_ID,
  label: "desk",
  deviceId: "dev_1",
  pairedAt: "2026-11-01T05:00:00.000Z",
  tokenCiphertext: "cipher",
};

type Route = (init: RequestInit | undefined) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function descriptor(overrides: Record<string, unknown> = {}): Response {
  return json({
    descriptorVersion: 1,
    environmentId: ENV_ID,
    label: "desk",
    protocolVersion: 1,
    capabilities: { pairing: true, deviceSessions: true, terminalAuth: true },
    ...overrides,
  });
}

function makeDeps(routes: Record<string, Route>): MachineClientDeps & { fetchImpl: ReturnType<typeof vi.fn> } {
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected request ${key}`);
    return route(init);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch & ReturnType<typeof vi.fn>, lookupAll: vi.fn(async () => []) };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return init?.headers as Record<string, string>;
}

function callFor(deps: { fetchImpl: ReturnType<typeof vi.fn> }, key: string): RequestInit | undefined {
  const call = deps.fetchImpl.mock.calls.find(([input, init]) => {
    return `${(init as RequestInit | undefined)?.method ?? "GET"} ${new URL(String(input)).pathname}` === key;
  });
  return call?.[1] as RequestInit | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.credentialStoreStatus.mockReturnValue({ ok: true });
  store.loadMachineRecord.mockReturnValue(null);
  store.readMachineToken.mockReturnValue(TOKEN);
});

describe("pairWithMachine", () => {
  it("exchanges with Origin, bearer delivery and the hostname label, then saves the record", async () => {
    const deps = makeDeps({
      "GET /api/environment": () => descriptor(),
      "POST /api/pairing/exchange": () => json({ deviceId: "dev_9", environmentId: ENV_ID, csrfToken: "c", token: TOKEN }),
    });
    store.loadMachineRecord.mockReturnValueOnce(null).mockReturnValueOnce({ ...RECORD, deviceId: "dev_9" });

    const result = await pairWithMachine(LINK, deps);

    expect(result).toEqual({ ok: true, record: { ...RECORD, deviceId: "dev_9" } });
    const init = callFor(deps, "POST /api/pairing/exchange");
    expect(headersOf(init).Origin).toBe(BASE);
    expect(JSON.parse(String(init?.body))).toEqual({
      credential: "odp_onetime",
      label: `Overdeck desktop on ${OS.hostname()}`.slice(0, 200),
      delivery: "bearer",
    });
    expect(store.saveMachineRecord).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, baseUrl: BASE, environmentId: ENV_ID, label: "desk", deviceId: "dev_9" }),
      TOKEN,
    );
  });

  it("reports a 401 exchange with the server's text and saves nothing", async () => {
    const deps = makeDeps({
      "GET /api/environment": () => descriptor(),
      "POST /api/pairing/exchange": () => json({ error: "unknown or already used pairing credential" }, 401),
    });
    expect(await pairWithMachine(LINK, deps)).toEqual({
      ok: false,
      error: "Pairing failed: unknown or already used pairing credential",
    });
    expect(store.saveMachineRecord).not.toHaveBeenCalled();
  });

  it("tells the operator what to do about an untrusted origin", async () => {
    const deps = makeDeps({
      "GET /api/environment": () => descriptor(),
      "POST /api/pairing/exchange": () => json({ error: "Invalid origin" }, 403),
    });
    expect(await pairWithMachine(LINK, deps)).toEqual({
      ok: false,
      error: `Pairing failed: Invalid origin Add ${BASE} under Settings → Anywhere → trusted addresses on that machine.`,
    });
  });

  it("refuses an exchange answered by a different environment", async () => {
    const deps = makeDeps({
      "GET /api/environment": () => descriptor(),
      "POST /api/pairing/exchange": () => json({ deviceId: "dev_9", environmentId: "env-other", csrfToken: "c", token: TOKEN }),
    });
    const result = await pairWithMachine(LINK, deps);
    expect(result.ok).toBe(false);
    expect(store.saveMachineRecord).not.toHaveBeenCalled();
  });

  it("refuses before any request when the credential store is unavailable", async () => {
    store.credentialStoreStatus.mockReturnValue({ ok: false, error: "no store" });
    const deps = makeDeps({});
    expect(await pairWithMachine(LINK, deps)).toEqual({ ok: false, error: "no store" });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a disallowed address before any request", async () => {
    const deps = makeDeps({});
    const result = await pairWithMachine("http://192.168.1.5:3011/#pair=odp_x", deps);
    expect(result.ok).toBe(false);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a machine on another protocol version without spending the credential", async () => {
    const deps = makeDeps({ "GET /api/environment": () => descriptor({ protocolVersion: 2 }) });
    expect(await pairWithMachine(LINK, deps)).toEqual({
      ok: false,
      error: "desk speaks Overdeck protocol 2; this app supports 1. Update the older side.",
    });
  });

  it("revokes the previous device before saving the new record", async () => {
    const deps = makeDeps({
      "GET /api/environment": () => descriptor(),
      "POST /api/pairing/exchange": () => json({ deviceId: "dev_9", environmentId: ENV_ID, csrfToken: "c", token: TOKEN }),
      "POST /api/dashboard/session": () => json({ ok: true, csrfToken: "csrf-old" }),
      "DELETE /api/devices/dev_1": () => json({ ok: true }),
    });
    store.loadMachineRecord.mockReturnValueOnce(RECORD).mockReturnValueOnce({ ...RECORD, deviceId: "dev_9" });
    await pairWithMachine(LINK, deps);
    expect(callFor(deps, "DELETE /api/devices/dev_1")).toBeDefined();
    expect(store.saveMachineRecord).toHaveBeenCalled();
  });
});

describe("preflightMachine", () => {
  it("returns the token when the session mint answers 200", async () => {
    const deps = makeDeps({
      "GET /api/environment": () => descriptor(),
      "POST /api/dashboard/session": () => json({ ok: true, csrfToken: "c" }),
    });
    expect(await preflightMachine(RECORD, deps)).toEqual({ ok: true, token: TOKEN });
    const headers = headersOf(callFor(deps, "POST /api/dashboard/session"));
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.Origin).toBe(BASE);
  });

  it("maps an environment id mismatch to wrong-machine before the token leaves", async () => {
    const deps = makeDeps({ "GET /api/environment": () => descriptor({ environmentId: "env-other", label: "laptop" }) });
    expect(await preflightMachine(RECORD, deps)).toEqual({
      ok: false,
      reason: "wrong-machine",
      error: `${BASE} is now a different Overdeck machine (laptop). Pair again.`,
    });
    expect(store.readMachineToken).not.toHaveBeenCalled();
  });

  it("maps a session 401 to revoked", async () => {
    const deps = makeDeps({
      "GET /api/environment": () => descriptor(),
      "POST /api/dashboard/session": () => json({ error: "unauthorized" }, 401),
    });
    expect(await preflightMachine(RECORD, deps)).toEqual({
      ok: false,
      reason: "revoked",
      error: "desk no longer accepts this computer's credential. Pair again with a new link.",
    });
  });

  it("maps a rejected fetch to unreachable", async () => {
    const deps = makeDeps({
      "GET /api/environment": () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await preflightMachine(RECORD, deps)).toEqual({
      ok: false,
      reason: "unreachable",
      error: `Can't reach desk at ${BASE}. Check that its Overdeck is running and that this computer is on the same tailnet.`,
    });
  });

  it("maps a protocol mismatch to protocol", async () => {
    const deps = makeDeps({ "GET /api/environment": () => descriptor({ protocolVersion: 3 }) });
    const result = await preflightMachine(RECORD, deps);
    expect(result).toMatchObject({ ok: false, reason: "protocol" });
  });

  it("maps a decrypt failure to store", async () => {
    store.readMachineToken.mockImplementation(() => {
      throw new Error("keyring locked");
    });
    const deps = makeDeps({ "GET /api/environment": () => descriptor() });
    expect(await preflightMachine(RECORD, deps)).toEqual({ ok: false, reason: "store", error: STORE_DECRYPT_ERROR });
  });

  it("refuses a disallowed address as transport", async () => {
    const deps = makeDeps({});
    const result = await preflightMachine({ ...RECORD, baseUrl: "http://192.168.1.5:3011" }, deps);
    expect(result).toMatchObject({ ok: false, reason: "transport" });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("revokeOwnDevice", () => {
  it("sends the CSRF token from the mint response", async () => {
    const deps = makeDeps({
      "POST /api/dashboard/session": () => json({ ok: true, csrfToken: "csrf-1" }),
      "DELETE /api/devices/dev_1": () => json({ ok: true }),
    });
    expect(await revokeOwnDevice(RECORD, TOKEN, deps)).toBe(true);
    const headers = headersOf(callFor(deps, "DELETE /api/devices/dev_1"));
    expect(headers["x-overdeck-csrf-token"]).toBe("csrf-1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("returns false when the mint rejects", async () => {
    const deps = makeDeps({
      "POST /api/dashboard/session": () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await revokeOwnDevice(RECORD, TOKEN, deps)).toBe(false);
  });
});
