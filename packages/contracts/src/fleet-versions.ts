// Fleet versions and Update all (PAN-4654, Anywhere W-LINK7).
//
// Each machine reports its Overdeck version and the version of each installed
// harness CLI at `GET /api/versions/self`, plus its current update job. The
// viewing machine joins its own report with each linked machine's report into
// the fleet table (`GET /api/machines/versions`) and fans Update all out with
// one start request per machine (`POST /api/machines/update`).

import { Schema } from "effect"

import type { LinkState } from "./machines"

export const FleetInstallMode = Schema.Literals(["npm-global", "development", "desktop"])
export type FleetInstallMode = typeof FleetInstallMode.Type
export const FleetComponentStatus = Schema.Literals(["pending", "running", "updated", "current", "skipped", "failed"])
export type FleetComponentStatus = typeof FleetComponentStatus.Type
export const FleetJobPhase = Schema.Literals(["waiting", "updating", "restarting", "done", "failed", "cancelled"])
export type FleetJobPhase = typeof FleetJobPhase.Type
export const FleetUpdateMode = Schema.Literals(["when-idle", "now"])
export type FleetUpdateMode = typeof FleetUpdateMode.Type

/** One installed harness CLI, deduplicated by binary. */
export interface HarnessVersionView {
  /** "claude", "codex", "kimi", … */
  binary: string
  /** `HarnessCapabilities.binaryLabel` of the first harness using the binary. */
  label: string
  /** Runtime names that use this binary, e.g. ["acp", "kimi-code"]. */
  harnesses: string[]
  version: string | null
  /** True when Overdeck may run the update plan's argv. */
  updatable: boolean
  /** Copyable command (the plan's display). */
  command: string
  /** Why the CLI is not updatable, or null. */
  reason: string | null
}

/** One thing an update job updates: `overdeck` or one harness CLI binary. */
export interface FleetComponent {
  /** "overdeck" or a binary name. */
  name: string
  /** "Overdeck", "Claude Code", … */
  label: string
  before: string | null
  after: string | null
  status: FleetComponentStatus
  /** The reason, or the output tail on failure. */
  detail: string | null
}

export interface FleetUpdateJob {
  id: string
  mode: FleetUpdateMode
  phase: FleetJobPhase
  /** "operator" or "machine:<label>". */
  requestedBy: string
  /** ISO-8601 UTC. */
  startedAt: string
  /** Working turns at the last check (0 once updating). */
  waitingTurns: number
  waitingSince: string | null
  finishedAt: string | null
  components: FleetComponent[]
}

export interface MachineVersionsReport {
  environmentId: string
  label: string
  overdeck: { version: string; installMode: FleetInstallMode; linkProtocol: number }
  harnesses: HarnessVersionView[]
  job: FleetUpdateJob | null
}

/** One row of the fleet table: this machine first, then each outbound link. */
export interface FleetVersionRow {
  environmentId: string
  label: string
  self: boolean
  state: LinkState | "self"
  stateDetail: string | null
  peerVersion: string | null
  report: MachineVersionsReport | null
  updateSupported: boolean
  install: { version: string; on: "this-machine" | "peer"; command: string } | null
  error: string | null
}

export interface FleetVersionsResponse {
  rows: FleetVersionRow[]
}

export interface FleetUpdateResponse {
  started: { environmentId: string; label: string; job: FleetUpdateJob }[]
  skipped: { environmentId: string; label: string; reason: string }[]
}

/** Fleet-table column order (D-16): these binaries first, then any other binary alphabetically. */
export const FLEET_BINARY_ORDER: readonly string[] = ["claude", "codex", "kimi", "opencode", "muse", "prime-agent", "omp"]

/** Sort comparator for harness binary names in D-16 order. */
export function compareFleetBinaries(a: string, b: string): number {
  const rank = (binary: string): number => {
    const index = FLEET_BINARY_ORDER.indexOf(binary)
    return index === -1 ? FLEET_BINARY_ORDER.length : index
  }
  return rank(a) - rank(b) || a.localeCompare(b)
}

/** After this long waiting for turns, the row says it is still waiting and points at Update now (FR-8). */
export const FLEET_UPDATE_STILL_WAITING_MS = 30 * 60_000

const FleetComponentSchema = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  before: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
  status: FleetComponentStatus,
  detail: Schema.NullOr(Schema.String),
})

/** Decodes a persisted job file. */
export const FleetUpdateJobSchema = Schema.Struct({
  id: Schema.String,
  mode: FleetUpdateMode,
  phase: FleetJobPhase,
  requestedBy: Schema.String,
  startedAt: Schema.String,
  waitingTurns: Schema.Number,
  waitingSince: Schema.NullOr(Schema.String),
  finishedAt: Schema.NullOr(Schema.String),
  components: Schema.Array(FleetComponentSchema),
})

/** Decodes a peer's `GET /api/versions/self` body. */
export const MachineVersionsReportSchema = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  overdeck: Schema.Struct({ version: Schema.String, installMode: FleetInstallMode, linkProtocol: Schema.Number }),
  harnesses: Schema.Array(Schema.Struct({
    binary: Schema.String,
    label: Schema.String,
    harnesses: Schema.Array(Schema.String),
    version: Schema.NullOr(Schema.String),
    updatable: Schema.Boolean,
    command: Schema.String,
    reason: Schema.NullOr(Schema.String),
  })),
  job: Schema.NullOr(FleetUpdateJobSchema),
})
