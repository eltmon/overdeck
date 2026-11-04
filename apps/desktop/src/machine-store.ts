/**
 * The chosen machine's record, persisted to userData/remote-machine.json.
 *
 * Holds at most one machine (PAN-4402 D-1). The device token is stored only as
 * safeStorage ciphertext; the plaintext never reaches disk, a renderer or a log.
 * Saving refuses when the OS has no real secret store (D-4).
 */

import * as FS from "node:fs";
import * as Path from "node:path";

import { app, safeStorage } from "electron";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MachineRecord {
  version: 1;
  active: boolean;
  baseUrl: string;
  environmentId: string;
  label: string;
  deviceId: string;
  pairedAt: string;
  tokenCiphertext: string;
}

export type CredentialStoreStatus = { ok: true } | { ok: false; error: string };

export const NO_SECRET_STORE_ERROR =
  "This computer has no secure credential store (GNOME Keyring, KWallet, Keychain or Windows credential protection), so Overdeck will not save a machine credential.";

// ─── Internals ────────────────────────────────────────────────────────────────

function recordPath(): string {
  return Path.join(app.getPath("userData"), "remote-machine.json");
}

function writeRecord(record: MachineRecord): void {
  const final = recordPath();
  const tmp = `${final}.tmp`;
  FS.mkdirSync(Path.dirname(final), { recursive: true });
  FS.rmSync(tmp, { force: true });
  FS.writeFileSync(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  FS.renameSync(tmp, final);
}

function isMachineRecord(value: unknown): value is MachineRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.active === "boolean" &&
    typeof r.baseUrl === "string" &&
    typeof r.environmentId === "string" &&
    typeof r.label === "string" &&
    typeof r.deviceId === "string" &&
    typeof r.pairedAt === "string" &&
    typeof r.tokenCiphertext === "string"
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function credentialStoreStatus(): CredentialStoreStatus {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: NO_SECRET_STORE_ERROR };
  if (process.platform === "linux") {
    const backend = safeStorage.getSelectedStorageBackend();
    if (backend === "basic_text" || backend === "unknown") return { ok: false, error: NO_SECRET_STORE_ERROR };
  }
  return { ok: true };
}

export function loadMachineRecord(): MachineRecord | null {
  let raw: string;
  try {
    raw = FS.readFileSync(recordPath(), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isMachineRecord(parsed)) return parsed;
  } catch {
    // fall through to the single log line below
  }
  console.error("[desktop] ignoring malformed remote-machine.json");
  return null;
}

export function saveMachineRecord(
  input: Omit<MachineRecord, "version" | "tokenCiphertext">,
  token: string,
): void {
  const status = credentialStoreStatus();
  if (!status.ok) throw new Error(status.error);
  const tokenCiphertext = safeStorage.encryptString(token).toString("base64");
  writeRecord({
    version: 1,
    active: input.active,
    baseUrl: input.baseUrl,
    environmentId: input.environmentId,
    label: input.label,
    deviceId: input.deviceId,
    pairedAt: input.pairedAt,
    tokenCiphertext,
  });
}

export function setMachineActive(active: boolean): void {
  const record = loadMachineRecord();
  if (!record || record.active === active) return;
  writeRecord({ ...record, active });
}

export function readMachineToken(record: MachineRecord): string {
  return safeStorage.decryptString(Buffer.from(record.tokenCiphertext, "base64"));
}

export function deleteMachineRecord(): void {
  FS.rmSync(recordPath(), { force: true });
}
