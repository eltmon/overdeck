/**
 * Unit tests for the encrypted machine record (PAN-4402 W-2).
 *
 * Mocks 'electron' (app.getPath and a reversible fake safeStorage) and uses a
 * real temp directory, so the tests read the actual file the store writes.
 */

import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock electron before importing the store ─────────────────────────────────

let mockUserDataDir = "";
const fakeSafeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
  encryptString: vi.fn((plain: string) => Buffer.from([...plain].reverse().join(""), "utf8")),
  decryptString: vi.fn((cipher: Buffer) => [...cipher.toString("utf8")].reverse().join("")),
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "userData") return mockUserDataDir;
      throw new Error(`Unexpected getPath call: ${name}`);
    },
  },
  safeStorage: fakeSafeStorage,
}));

import {
  NO_SECRET_STORE_ERROR,
  credentialStoreStatus,
  deleteMachineRecord,
  loadMachineRecord,
  readMachineToken,
  saveMachineRecord,
  setMachineActive,
} from "../src/machine-store.js";

const TOKEN = "odk_supersecret_token_value";
const INPUT = {
  active: true,
  baseUrl: "http://100.101.102.103:3011",
  environmentId: "0f8c2b1e-1111-4222-8333-944455556666",
  label: "desk",
  deviceId: "dev_123",
  pairedAt: "2026-11-01T05:00:00.000Z",
};

function recordFile(): string {
  return Path.join(mockUserDataDir, "remote-machine.json");
}

const originalPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

beforeEach(() => {
  mockUserDataDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "overdeck-machine-store-"));
  fakeSafeStorage.isEncryptionAvailable.mockReturnValue(true);
  fakeSafeStorage.getSelectedStorageBackend.mockReturnValue("gnome_libsecret");
});

afterEach(() => {
  setPlatform(originalPlatform);
  FS.rmSync(mockUserDataDir, { recursive: true, force: true });
});

describe("machine record", () => {
  it("round-trips every field and decrypts the token", () => {
    saveMachineRecord(INPUT, TOKEN);
    const record = loadMachineRecord();
    expect(record).toEqual({ version: 1, ...INPUT, tokenCiphertext: expect.any(String) });
    expect(readMachineToken(record!)).toBe(TOKEN);
  });

  it("never writes the token in plain text", () => {
    saveMachineRecord(INPUT, TOKEN);
    expect(FS.readFileSync(recordFile(), "utf8")).not.toContain(TOKEN);
  });

  it("writes the file with mode 0o600 and leaves no temp file", () => {
    saveMachineRecord(INPUT, TOKEN);
    if (process.platform !== "win32") {
      expect(FS.statSync(recordFile()).mode & 0o777).toBe(0o600);
    }
    expect(FS.readdirSync(mockUserDataDir)).toEqual(["remote-machine.json"]);
  });

  it("refuses to save when encryption is unavailable", () => {
    fakeSafeStorage.isEncryptionAvailable.mockReturnValue(false);
    expect(() => saveMachineRecord(INPUT, TOKEN)).toThrow(NO_SECRET_STORE_ERROR);
    expect(FS.existsSync(recordFile())).toBe(false);
  });

  it("refuses to save on Linux with the basic_text or unknown backend", () => {
    setPlatform("linux");
    for (const backend of ["basic_text", "unknown"]) {
      fakeSafeStorage.getSelectedStorageBackend.mockReturnValue(backend);
      expect(credentialStoreStatus()).toEqual({ ok: false, error: NO_SECRET_STORE_ERROR });
      expect(() => saveMachineRecord(INPUT, TOKEN)).toThrow(NO_SECRET_STORE_ERROR);
    }
    expect(FS.existsSync(recordFile())).toBe(false);
  });

  it("ignores the storage backend outside Linux", () => {
    setPlatform("darwin");
    fakeSafeStorage.getSelectedStorageBackend.mockReturnValue("basic_text");
    expect(credentialStoreStatus()).toEqual({ ok: true });
  });

  it("loads a missing or malformed file as null", () => {
    expect(loadMachineRecord()).toBeNull();
    FS.writeFileSync(recordFile(), "{not json");
    expect(loadMachineRecord()).toBeNull();
    FS.writeFileSync(recordFile(), JSON.stringify({ version: 2, baseUrl: "x" }));
    expect(loadMachineRecord()).toBeNull();
  });

  it("toggles the active flag without touching the ciphertext", () => {
    saveMachineRecord(INPUT, TOKEN);
    const before = loadMachineRecord()!;
    setMachineActive(false);
    const after = loadMachineRecord()!;
    expect(after.active).toBe(false);
    expect(after.tokenCiphertext).toBe(before.tokenCiphertext);
  });

  it("deletes the record, and a second delete does not throw", () => {
    saveMachineRecord(INPUT, TOKEN);
    deleteMachineRecord();
    expect(FS.existsSync(recordFile())).toBe(false);
    expect(() => deleteMachineRecord()).not.toThrow();
  });
});
