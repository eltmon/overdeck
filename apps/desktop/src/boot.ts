/**
 * Boot decision: run the embedded server, or open the chosen machine with no
 * local server (PAN-4402 W-6, D-7). Pure, so it is tested without Electron.
 */

import type { MachineRecord } from "./machine-store.js";

export type BootPlan = { kind: "local" } | { kind: "remote"; record: MachineRecord };

/** Local when there is no record, the record is inactive, or the Vite dev server is in use. */
export function planBoot(record: MachineRecord | null, isDevelopment: boolean): BootPlan {
  if (!record || !record.active || isDevelopment) return { kind: "local" };
  return { kind: "remote", record };
}
