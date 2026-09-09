/**
 * Machine-wide CPU admission for direct Vitest runs (PAN-3344).
 *
 * Verification gates already hold the shared lease and set
 * OVERDECK_GATE_ADMITTED=1. Direct agent-shell suites enter through this
 * global setup so every local Vitest invocation uses the same admission door.
 */
import {
  acquireQualityGateAdmission,
  type QualityGateAdmissionHandle,
} from '../src/lib/cloister/quality-gate-admission.js'

const MAX_WAIT_MS = 30 * 60_000

export interface VitestCpuAdmissionDeps {
  env?: NodeJS.ProcessEnv
  acquire?: typeof acquireQualityGateAdmission
  rootDir?: string
  warn?: (message: string) => void
}

let admission: QualityGateAdmissionHandle | null = null
let admittedEnv: NodeJS.ProcessEnv | null = null
let priorAdmittedValue: string | undefined

export async function setup(deps: VitestCpuAdmissionDeps = {}): Promise<void> {
  const env = deps.env ?? process.env
  if (env.OVERDECK_GATE_ADMITTED === '1' || env.OVERDECK_GATE_ADMISSION === '0' || env.CI) return

  try {
    admission = await (deps.acquire ?? acquireQualityGateAdmission)(
      { workspacePath: process.cwd(), gateName: 'vitest', attempt: 1 },
      { maxWaitMs: MAX_WAIT_MS, rootDir: deps.rootDir },
    )
    admittedEnv = env
    priorAdmittedValue = env.OVERDECK_GATE_ADMITTED
    env.OVERDECK_GATE_ADMITTED = '1'
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    ;(deps.warn ?? console.warn)(`[vitest-admission] proceeding without CPU admission: ${reason}`)
  }
}

export async function teardown(): Promise<void> {
  const currentAdmission = admission
  admission = null
  try {
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

export default setup
