/**
 * Unit tests for the active-dashboard state and remote session setup (PAN-4402 W-4).
 *
 * Electron's session is mocked; global fetch is stubbed, so nothing touches
 * the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const cookiesSet = vi.fn(async () => undefined);
  return {
    cookiesSet,
    fromPartition: vi.fn(() => ({ cookies: { set: cookiesSet } })),
  };
});

vi.mock("electron", () => ({
  session: { fromPartition: electron.fromPartition },
}));

import {
  dashboardFetch,
  getActiveDashboard,
  isSameOrigin,
  prepareRemoteSession,
  remotePartitionName,
  setLocalDashboard,
  setRemoteDashboard,
} from "../src/connection.js";
import type { MachineRecord } from "../src/machine-store.js";

const TOKEN = "odk_device_token";

function record(baseUrl: string): MachineRecord {
  return {
    version: 1,
    active: true,
    baseUrl,
    environmentId: "env-desk",
    label: "desk",
    deviceId: "dev_1",
    pairedAt: "2026-11-01T05:00:00.000Z",
    tokenCiphertext: "cipher",
  };
}

const fetchMock = vi.fn(async () => new Response("{}"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboardFetch", () => {
  it("calls the embedded server with no Authorization in local mode", async () => {
    setLocalDashboard("http://127.0.0.1:7825");
    await dashboardFetch("/api/health");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:7825/api/health");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("calls the chosen machine with the bearer token in remote mode", async () => {
    setRemoteDashboard(record("http://100.101.102.103:3011"), TOKEN);
    await dashboardFetch("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://100.101.102.103:3011/api/workspaces");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("rejects before the embedded server is ready", async () => {
    setLocalDashboard("");
    await expect(dashboardFetch("/api/health")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("prepareRemoteSession", () => {
  it("sets an httpOnly strict device cookie in an in-memory partition over http", async () => {
    setRemoteDashboard(record("http://100.101.102.103:3011"), TOKEN);
    const active = getActiveDashboard();
    if (active.kind !== "remote") throw new Error("expected remote mode");

    await prepareRemoteSession(active);

    expect(active.partition).toBe("remote-env-desk");
    expect(active.partition.startsWith("persist:")).toBe(false);
    expect(electron.fromPartition).toHaveBeenCalledWith("remote-env-desk");
    expect(electron.cookiesSet).toHaveBeenCalledWith({
      url: "http://100.101.102.103:3011",
      name: "overdeck_device",
      value: TOKEN,
      httpOnly: true,
      sameSite: "strict",
      secure: false,
    });
  });

  it("marks the cookie secure over https", async () => {
    setRemoteDashboard(record("https://desk.tail1234.ts.net"), TOKEN);
    const active = getActiveDashboard();
    if (active.kind !== "remote") throw new Error("expected remote mode");
    await prepareRemoteSession(active);
    expect(electron.cookiesSet).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it("refuses a persistent partition", async () => {
    await expect(prepareRemoteSession({
      kind: "remote",
      baseUrl: "http://127.0.0.1:3911",
      partition: "persist:remote-env-desk",
      label: "desk",
      token: TOKEN,
    })).rejects.toThrow();
    expect(electron.cookiesSet).not.toHaveBeenCalled();
  });

  it("names the partition from the environment id", () => {
    expect(remotePartitionName("abc")).toBe("remote-abc");
  });
});

describe("isSameOrigin", () => {
  it("accepts a path on the base origin and refuses another port", () => {
    expect(isSameOrigin("http://100.101.102.103:3011/issues/PAN-1", "http://100.101.102.103:3011")).toBe(true);
    expect(isSameOrigin("http://100.101.102.103:3012/", "http://100.101.102.103:3011")).toBe(false);
    expect(isSameOrigin("not a url", "http://100.101.102.103:3011")).toBe(false);
  });
});
