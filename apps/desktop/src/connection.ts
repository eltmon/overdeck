/**
 * The dashboard the desktop app currently shows: the embedded local server or
 * the one chosen machine (PAN-4402 W-4).
 *
 * This is the one piece of runtime state main, menu and tray share. In remote
 * mode main-process calls carry the device token as a bearer (D-10), and the
 * remote windows authenticate with the device cookie set in an in-memory
 * partition, so the cookie never reaches disk (D-3).
 */

import { session } from "electron";

import type { MachineRecord } from "./machine-store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActiveDashboard =
  | { kind: "local"; baseUrl: string }
  | { kind: "remote"; baseUrl: string; partition: string; label: string; token: string };

export type RemoteDashboard = Extract<ActiveDashboard, { kind: "remote" }>;

// ─── State ────────────────────────────────────────────────────────────────────

/** baseUrl is '' until the embedded server is ready. */
let active: ActiveDashboard = { kind: "local", baseUrl: "" };

// ─── Public API ───────────────────────────────────────────────────────────────

export function getActiveDashboard(): ActiveDashboard {
  return active;
}

export function setLocalDashboard(baseUrl: string): void {
  active = { kind: "local", baseUrl };
}

/** No `persist:` prefix, so the partition's cookies and storage stay in memory. */
export function remotePartitionName(environmentId: string): string {
  return `remote-${environmentId}`;
}

export function setRemoteDashboard(record: MachineRecord, token: string): void {
  active = {
    kind: "remote",
    baseUrl: record.baseUrl,
    partition: remotePartitionName(record.environmentId),
    label: record.label,
    token,
  };
}

export function dashboardFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const current = active;
  if (!current.baseUrl) return Promise.reject(new Error("The dashboard server is not ready yet."));
  if (current.kind === "local") return fetch(`${current.baseUrl}${path}`, init);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${current.token}`);
  return fetch(`${current.baseUrl}${path}`, { ...init, headers });
}

export async function prepareRemoteSession(remote: RemoteDashboard): Promise<Electron.Session> {
  if (remote.partition.startsWith("persist:")) {
    throw new Error(`Refusing to store a machine credential in the persistent partition ${remote.partition}.`);
  }
  const ses = session.fromPartition(remote.partition);
  await ses.cookies.set({
    url: remote.baseUrl,
    name: "overdeck_device",
    value: remote.token,
    httpOnly: true,
    sameSite: "strict",
    secure: remote.baseUrl.startsWith("https:"),
  });
  return ses;
}

export function isSameOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
