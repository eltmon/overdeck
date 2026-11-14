/**
 * Machine-wide CPU and memory admission for direct Vitest runs (PAN-3344, PAN-5248).
 *
 * Verification gates already hold a shared admission slot and set
 * OVERDECK_GATE_ADMITTED=1. Direct agent-shell suites enter through this
 * global setup so every local Vitest invocation uses the same admission door.
 * The run's peak tree RSS (this process and its forks) is recorded under
 * `vitest:<cwd relative to the repo root>` so the next run's memory estimate
 * is measured, not guessed. A memory timeout stops the run (FR-9).
 */
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { memoryRefusalMessage, memoryTimeoutOf } from '../src/lib/cloister/gate-admission-run.js'
import {
  acquireQualityGateAdmission,
  type QualityGateAdmissionHandle,
} from '../src/lib/cloister/quality-gate-admission.js'
import { startPeakRssSampler, type PeakRssSampler } from '../src/lib/system-health/process-tree-rss.js'

const MAX_WAIT_MS = 30 * 60_000

export interface VitestCpuAdmissionDeps {
  env?: NodeJS.ProcessEnv
  acquire?: typeof acquireQualityGateAdmission
  rootDir?: string
  warn?: (message: string) => void
  startSampler?: typeof startPeakRssSampler
}

/** D13: `vitest:<path from the nearest ancestor with a .git entry to cwd>`, or `vitest:.`. */
export function vitestFootprintKey(cwd: string): string {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return `vitest:${relative(dir, cwd) || '.'}`
    if (dirname(dir) === dir) return 'vitest:.'
  }
}

let admission: QualityGateAdmissionHandle | null = null
let sampler: PeakRssSampler | null = null
let admittedEnv: NodeJS.ProcessEnv | null = null
let priorAdmittedValue: string | undefined

export async function setup(deps: VitestCpuAdmissionDeps = {}): Promise<void> {
  const env = deps.env ?? process.env
  if (env.OVERDECK_GATE_ADMITTED === '1' || env.OVERDECK_GATE_ADMISSION === '0' || env.CI) return

  try {
    admission = await (deps.acquire ?? acquireQualityGateAdmission)(
      { workspacePath: process.cwd(), gateName: 'vitest', attempt: 1, footprintKey: vitestFootprintKey(process.cwd()) },
      { maxWaitMs: MAX_WAIT_MS, rootDir: deps.rootDir },
    )
    admittedEnv = env
    priorAdmittedValue = env.OVERDECK_GATE_ADMITTED
    env.OVERDECK_GATE_ADMITTED = '1'
    sampler = (deps.startSampler ?? startPeakRssSampler)(process.pid)
  } catch (error) {
    const memoryTimeout = memoryTimeoutOf(error)
    if (memoryTimeout) throw new Error(memoryRefusalMessage('vitest', MAX_WAIT_MS, memoryTimeout.reason))
    const reason = error instanceof Error ? error.message : String(error)
    ;(deps.warn ?? console.warn)(`[vitest-admission] proceeding without admission: ${reason}`)
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

/**
 * Vitest entry point. With a default export, Vitest ignores the named
 * `teardown` and uses whatever the default returns as the teardown hook, and
 * it calls the default with its TestProject, which must not reach `setup` as
 * deps. Returning `teardown` is what releases the slot and records the peak.
 */
export default async function vitestGlobalSetup(): Promise<() => Promise<void>> {
  await setup()
  return teardown
}
