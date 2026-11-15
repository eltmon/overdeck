/**
 * Machine-wide CPU and memory admission for direct Vitest runs (PAN-3344, PAN-5248).
 *
 * Verification gates already hold a shared admission slot and set
 * OVERDECK_GATE_ADMITTED=1. Direct agent-shell suites enter through this
 * global setup so every local Vitest invocation uses the same admission door.
 * The run's peak tree RSS (this process and its forks) is recorded under
 * `vitest:<cwd relative to the repo root>:<suite|files>` so the next run's
 * memory estimate is measured, not guessed, and a file-targeted run never
 * inherits a full-suite peak (PAN-5285). A memory timeout stops the run (FR-9).
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import {
  admittedAloneMessage,
  describeWait,
  memoryRefusalMessage,
  memoryTimeoutOf,
} from '../src/lib/cloister/gate-admission-run.js'
import {
  acquireQualityGateAdmission,
  type QualityGateAdmissionHandle,
} from '../src/lib/cloister/quality-gate-admission.js'
import { startPeakRssSampler, type PeakRssSampler } from '../src/lib/system-health/process-tree-rss.js'

const MAX_WAIT_MS = 30 * 60_000
/** PAN-5285: more file filters than this is a suite-sized run (the frontend subset passes hundreds). */
const FILES_SHAPE_MAX_FILTERS = 10

export interface VitestCpuAdmissionDeps {
  env?: NodeJS.ProcessEnv
  acquire?: typeof acquireQualityGateAdmission
  rootDir?: string
  warn?: (message: string) => void
  startSampler?: typeof startPeakRssSampler
  /** The run's CLI file filters (Vitest's `filenamePattern`); none means the whole suite. */
  filters?: readonly string[]
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * PAN-5285: `files` only when every filter names an existing file (a
 * `<file>:<line>` location counts) and there are at most a few of them. Vitest matches filters as path substrings, so a
 * directory, a pattern such as `.test.ts` or `admission`, no filters, or a
 * long list may select a suite-sized run, and those count as `suite`.
 */
export function vitestRunShape(cwd: string, filters: readonly string[] | undefined): 'suite' | 'files' {
  if (!filters?.length || filters.length > FILES_SHAPE_MAX_FILTERS) return 'suite'
  return filters.every((filter) => isFileFilter(cwd, filter)) ? 'files' : 'suite'
}

/** A filter naming one file, including Vitest's `<file>:<line>` location form. */
function isFileFilter(cwd: string, filter: string): boolean {
  if (isFile(resolve(cwd, filter))) return true
  const location = /^(.+):\d+$/.exec(filter)
  return location !== null && isFile(resolve(cwd, location[1]!))
}

/** D13 + PAN-5285: `vitest:<path from the nearest .git ancestor to cwd, or .>:<run shape>`. */
export function vitestFootprintKey(cwd: string, filters?: readonly string[]): string {
  const shape = vitestRunShape(cwd, filters)
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return `vitest:${relative(dir, cwd) || '.'}:${shape}`
    if (dirname(dir) === dir) return `vitest:.:${shape}`
  }
}

let admission: QualityGateAdmissionHandle | null = null
let sampler: PeakRssSampler | null = null
let admittedEnv: NodeJS.ProcessEnv | null = null
let priorAdmittedValue: string | undefined

export async function setup(deps: VitestCpuAdmissionDeps = {}): Promise<void> {
  const env = deps.env ?? process.env
  if (env.OVERDECK_GATE_ADMITTED === '1' || env.OVERDECK_GATE_ADMISSION === '0' || env.CI) return

  const warn = deps.warn ?? console.warn
  try {
    const footprintKey = vitestFootprintKey(process.cwd(), deps.filters)
    admission = await (deps.acquire ?? acquireQualityGateAdmission)(
      { workspacePath: process.cwd(), gateName: 'vitest', attempt: 1, footprintKey },
      {
        maxWaitMs: MAX_WAIT_MS,
        rootDir: deps.rootDir,
        // PAN-5285: say why the run has not started, instead of sitting silent.
        onWaiting: (reason) => warn(`[gate-admission] ${footprintKey} ${describeWait(reason)}`),
      },
    )
    if (admission.admittedAlone) warn(admittedAloneMessage(footprintKey, admission.footprintBytes))
    admittedEnv = env
    priorAdmittedValue = env.OVERDECK_GATE_ADMITTED
    env.OVERDECK_GATE_ADMITTED = '1'
    sampler = (deps.startSampler ?? startPeakRssSampler)(process.pid)
  } catch (error) {
    const memoryTimeout = memoryTimeoutOf(error)
    if (memoryTimeout) throw new Error(memoryRefusalMessage('vitest', MAX_WAIT_MS, memoryTimeout.reason))
    const reason = error instanceof Error ? error.message : String(error)
    warn(`[vitest-admission] proceeding without admission: ${reason}`)
  }
}

export async function teardown(): Promise<void> {
  const currentAdmission = admission
  const currentSampler = sampler
  admission = null
  sampler = null
  try {
    const peak = currentSampler ? await currentSampler.stop() : null
    if (currentAdmission && peak !== null) await currentAdmission.recordPeak(peak)
    await currentAdmission?.release()
  } finally {
    if (admittedEnv) {
      if (priorAdmittedValue === undefined) delete admittedEnv.OVERDECK_GATE_ADMITTED
      else admittedEnv.OVERDECK_GATE_ADMITTED = priorAdmittedValue
    }
    admittedEnv = null
    priorAdmittedValue = undefined
  }
}

/** The slice of Vitest's TestProject this setup reads; `filenamePattern` is set before global setup runs. */
interface VitestProjectLike {
  vitest?: { filenamePattern?: unknown }
}

function cliFilters(project: VitestProjectLike | undefined): string[] | undefined {
  const pattern = project?.vitest?.filenamePattern
  return Array.isArray(pattern) ? pattern.filter((entry): entry is string => typeof entry === 'string') : undefined
}

/**
 * Vitest entry point. With a default export, Vitest ignores the named
 * `teardown` and uses whatever the default returns as the teardown hook, and
 * it calls the default with its TestProject, which must not reach `setup` as
 * deps; only its CLI filters are passed on. Returning `teardown` is what
 * releases the slot and records the peak.
 */
export default async function vitestGlobalSetup(project?: VitestProjectLike): Promise<() => Promise<void>> {
  await setup({ filters: cliFilters(project) })
  return teardown
}
