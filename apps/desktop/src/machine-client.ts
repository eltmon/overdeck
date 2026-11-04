/**
 * HTTP client for the chosen machine: pairing exchange, launch preflight and
 * self-revoke (PAN-4402 W-3).
 *
 * Every function takes injected `fetchImpl` and `lookupAll`, so tests run with
 * no network. The pairing credential is spent only at the exchange step, after
 * every local check has passed. Error texts are the FR-5 sentences.
 */

import * as OS from "node:os";
import { promises as DNS } from "node:dns";

import {
  type LookupAll,
  assessMachineTransport,
  parsePairingLink,
} from "./machine-url.js";
import {
  type MachineRecord,
  credentialStoreStatus,
  loadMachineRecord,
  readMachineToken,
  saveMachineRecord,
} from "./machine-store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Mirrors ENVIRONMENT_PROTOCOL_VERSION in packages/contracts/src/environment.ts. */
export const SUPPORTED_ENVIRONMENT_PROTOCOL_VERSION = 1;

const REQUEST_TIMEOUT_MS = 5_000;

export interface MachineClientDeps {
  fetchImpl: typeof fetch;
  lookupAll: LookupAll;
}

export interface MachineDescriptor {
  environmentId: string;
  label: string;
  protocolVersion: number;
  pairing: boolean;
}

export type DescriptorResult = { ok: true; descriptor: MachineDescriptor } | { ok: false; error: string };

export type PairResult = { ok: true; record: MachineRecord } | { ok: false; error: string };

export type PreflightFailureReason = "transport" | "unreachable" | "wrong-machine" | "protocol" | "revoked" | "store";

export type PreflightResult =
  | { ok: true; token: string }
  | { ok: false; reason: PreflightFailureReason; error: string };

// ─── Messages (FR-5) ──────────────────────────────────────────────────────────

export function unreachableMessage(origin: string, label?: string): string {
  const who = label ? `${label} at ${origin}` : origin;
  return `Can't reach ${who}. Check that its Overdeck is running and that this computer is on the same tailnet.`;
}

export function wrongMachineMessage(origin: string, newLabel: string): string {
  return `${origin} is now a different Overdeck machine (${newLabel}). Pair again.`;
}

export function revokedMessage(label: string): string {
  return `${label} no longer accepts this computer's credential. Pair again with a new link.`;
}

export function protocolMessage(label: string, version: number): string {
  return `${label} speaks Overdeck protocol ${version}; this app supports ${SUPPORTED_ENVIRONMENT_PROTOCOL_VERSION}. Update the older side.`;
}

export const STORE_DECRYPT_ERROR =
  "This computer's credential store could not decrypt the saved credential. Pair again.";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Production DNS lookup for the transport policy. */
export async function lookupAllAddresses(host: string): Promise<string[]> {
  const results = await DNS.lookup(host, { all: true });
  return results.map((result) => result.address);
}

export function deviceLabel(): string {
  return `Overdeck desktop on ${OS.hostname()}`.slice(0, 200);
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function mintSession(baseUrl: string, token: string, deps: MachineClientDeps): Promise<Response> {
  return deps.fetchImpl(`${baseUrl}/api/dashboard/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Origin: baseUrl },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchMachineDescriptor(baseUrl: string, deps: MachineClientDeps): Promise<DescriptorResult> {
  let body: Record<string, unknown> | null;
  try {
    const response = await deps.fetchImpl(`${baseUrl}/api/environment`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: unreachableMessage(baseUrl) };
    body = await readJson(response);
  } catch {
    return { ok: false, error: unreachableMessage(baseUrl) };
  }
  if (
    !body ||
    body.descriptorVersion !== 1 ||
    typeof body.environmentId !== "string" ||
    typeof body.label !== "string" ||
    typeof body.protocolVersion !== "number"
  ) {
    return { ok: false, error: `${baseUrl} did not answer as an Overdeck machine.` };
  }
  const capabilities = body.capabilities as Record<string, unknown> | undefined;
  return {
    ok: true,
    descriptor: {
      environmentId: body.environmentId,
      label: body.label,
      protocolVersion: body.protocolVersion,
      pairing: capabilities?.pairing === true,
    },
  };
}

export async function pairWithMachine(linkText: string, deps: MachineClientDeps): Promise<PairResult> {
  const parsed = parsePairingLink(linkText);
  if (!parsed.ok) return parsed;
  const { baseUrl, credential } = parsed.link;

  const store = credentialStoreStatus();
  if (!store.ok) return store;

  const transport = await assessMachineTransport(baseUrl, deps.lookupAll);
  if (!transport.ok) return transport;

  const described = await fetchMachineDescriptor(baseUrl, deps);
  if (!described.ok) return described;
  const { descriptor } = described;
  if (descriptor.protocolVersion !== SUPPORTED_ENVIRONMENT_PROTOCOL_VERSION) {
    return { ok: false, error: protocolMessage(descriptor.label, descriptor.protocolVersion) };
  }
  if (!descriptor.pairing) return { ok: false, error: `${descriptor.label} does not accept pairing.` };

  let response: Response;
  try {
    response = await deps.fetchImpl(`${baseUrl}/api/pairing/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ credential, label: deviceLabel(), delivery: "bearer" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: unreachableMessage(baseUrl, descriptor.label) };
  }
  const body = await readJson(response);
  if (!response.ok) {
    const serverError = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    const hint = serverError === "Invalid origin"
      ? ` Add ${baseUrl} under Settings → Anywhere → trusted addresses on that machine.`
      : "";
    return { ok: false, error: `Pairing failed: ${serverError}${hint}` };
  }
  const token = body?.token;
  const deviceId = body?.deviceId;
  if (typeof token !== "string" || !token.startsWith("odk_") || typeof deviceId !== "string") {
    return { ok: false, error: "Pairing failed: the machine did not return a device credential." };
  }
  if (body?.environmentId !== descriptor.environmentId) {
    return { ok: false, error: wrongMachineMessage(baseUrl, descriptor.label) };
  }

  const previous = loadMachineRecord();
  if (previous) {
    try {
      await revokeOwnDevice(previous, readMachineToken(previous), deps);
    } catch {
      // Best effort (FR-9): an undecryptable old token cannot be revoked from here.
    }
  }

  saveMachineRecord(
    {
      active: true,
      baseUrl,
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      deviceId,
      pairedAt: new Date().toISOString(),
    },
    token,
  );
  const record = loadMachineRecord();
  if (!record) return { ok: false, error: "Pairing failed: the machine record could not be saved." };
  return { ok: true, record };
}

export async function preflightMachine(record: MachineRecord, deps: MachineClientDeps): Promise<PreflightResult> {
  const { baseUrl, label } = record;

  const transport = await assessMachineTransport(baseUrl, deps.lookupAll);
  if (!transport.ok) return { ok: false, reason: "transport", error: transport.error };

  const described = await fetchMachineDescriptor(baseUrl, deps);
  if (!described.ok) return { ok: false, reason: "unreachable", error: unreachableMessage(baseUrl, label) };
  const { descriptor } = described;
  if (descriptor.environmentId !== record.environmentId) {
    return { ok: false, reason: "wrong-machine", error: wrongMachineMessage(baseUrl, descriptor.label) };
  }
  if (descriptor.protocolVersion !== SUPPORTED_ENVIRONMENT_PROTOCOL_VERSION) {
    return { ok: false, reason: "protocol", error: protocolMessage(label, descriptor.protocolVersion) };
  }

  let token: string;
  try {
    token = readMachineToken(record);
  } catch {
    return { ok: false, reason: "store", error: STORE_DECRYPT_ERROR };
  }

  let response: Response;
  try {
    response = await mintSession(baseUrl, token, deps);
  } catch {
    return { ok: false, reason: "unreachable", error: unreachableMessage(baseUrl, label) };
  }
  if (response.status === 200) return { ok: true, token };
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "revoked", error: revokedMessage(label) };
  }
  return { ok: false, reason: "unreachable", error: unreachableMessage(baseUrl, label) };
}

export async function revokeOwnDevice(record: MachineRecord, token: string, deps: MachineClientDeps): Promise<boolean> {
  try {
    const mint = await mintSession(record.baseUrl, token, deps);
    if (!mint.ok) return false;
    const csrfToken = (await readJson(mint))?.csrfToken;
    if (typeof csrfToken !== "string") return false;
    const response = await deps.fetchImpl(
      `${record.baseUrl}/api/devices/${encodeURIComponent(record.deviceId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Origin: record.baseUrl,
          "x-overdeck-csrf-token": csrfToken,
        },
        body: "{}",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
