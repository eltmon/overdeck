/**
 * Unit tests for the boot decision (PAN-4402 W-6).
 */

import { describe, expect, it } from "vitest";

import { planBoot } from "../src/boot.js";
import type { MachineRecord } from "../src/machine-store.js";

const RECORD: MachineRecord = {
  version: 1,
  active: true,
  baseUrl: "http://100.101.102.103:3011",
  environmentId: "env-desk",
  label: "desk",
  deviceId: "dev_1",
  pairedAt: "2026-11-01T05:00:00.000Z",
  tokenCiphertext: "cipher",
};

describe("planBoot", () => {
  it("boots local with no record", () => {
    expect(planBoot(null, false)).toEqual({ kind: "local" });
  });

  it("boots remote with an active record", () => {
    expect(planBoot(RECORD, false)).toEqual({ kind: "remote", record: RECORD });
  });

  it("boots local with an inactive record", () => {
    expect(planBoot({ ...RECORD, active: false }, false)).toEqual({ kind: "local" });
  });

  it("boots local in development even with an active record", () => {
    expect(planBoot(RECORD, true)).toEqual({ kind: "local" });
  });
});
