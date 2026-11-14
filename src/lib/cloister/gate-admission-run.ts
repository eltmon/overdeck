import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:os'

import { startPeakRssSampler, type PeakRssSampler } from '../system-health/process-tree-rss.js'
import {
  acquireQualityGateAdmission,
  type QualityGateAdmissionHandle,
  type QualityGateWaitReason,
} from './quality-gate-admission.js'

/**
 * Run one heavy command (a `tsc` lane) under machine-wide gate admission
 * (PAN-5248). `scripts/tsc-admitted.mjs` loads this module through tsx and
 * calls {@link runAdmittedCommand}; the wrapper must stay transparent to the
 * ratchet scripts, so the child inherits stdio, its exit code passes through,
 * and every message of our own goes to stderr prefixed `[gate-admission]`.
 *
 * Admission fails closed only on a memory timeout (exit 75, EX_TEMPFAIL);
 * every other admission failure runs the command unadmitted (D15).
 */

const GiB = 1024 ** 3
const WRAPPER_MAX_WAIT_MS = 30 * 60_000
export const EXIT_TEMPFAIL = 75
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

type MemoryWaitReason = Extract<QualityGateWaitReason, { kind: 'memory' }>

/** D13: `tsc:<-p/--project value without a leading ./>`, or `tsc:tsconfig.json`. */
export function tscFootprintKey(tscArgs: readonly string[]): string {
  for (let index = 0; index < tscArgs.length; index++) {
    const arg = tscArgs[index]!
    const value = arg === '-p' || arg === '--project'
      ? tscArgs[index + 1]
      : arg.startsWith('--project=') ? arg.slice('--project='.length) : undefined
    if (value) return `tsc:${value.replace(/^\.\//, '')}`
  }
  return 'tsc:tsconfig.json'
}

/** FR-6: CI, an operator opt-out, or a parent that already holds a slot. */
export function shouldBypassAdmission(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CI) || env.OVERDECK_GATE_ADMISSION === '0' || env.OVERDECK_GATE_ADMITTED === '1'
}

function gib(bytes: number): string {
  return `${(bytes / GiB).toFixed(1)} GiB`
}

/** `available X GiB, reserved Y GiB, needs Z GiB, soft reserve W GiB`. */
export function describeMemoryWait(reason: MemoryWaitReason): string {
  return `available ${gib(reason.memAvailableBytes)}, reserved ${gib(reason.reservationsBytes)}, `
    + `needs ${gib(reason.footprintBytes)}, soft reserve ${gib(reason.softReserveBytes)}`
}

function describeWait(reason: QualityGateWaitReason): string {
  switch (reason.kind) {
    case 'memory': return `waiting for memory: ${describeMemoryWait(reason)}`
    case 'cpu': return 'waiting for CPU pressure to clear'
    case 'slots': return 'waiting for a free admission slot'
    case 'queue': return 'waiting in the admission queue'
  }
}

/** The memory numbers of a memory-reason admission timeout, or null for any other failure. */
export function memoryTimeoutOf(error: unknown): { reason: MemoryWaitReason | undefined } | null {
  const candidate = error as { name?: unknown; lastWaitReason?: unknown; lastMemory?: MemoryWaitReason } | null
  if (candidate?.name !== 'QualityGateAdmissionTimeoutError' || candidate.lastWaitReason !== 'memory') return null
  return { reason: candidate.lastMemory }
}

/** FR-9 refusal line shared by the wrapper and the Vitest globalSetup. */
export function memoryRefusalMessage(subject: string, maxWaitMs: number, reason: MemoryWaitReason | undefined): string {
  const minutes = Math.round(maxWaitMs / 60_000)
  return `[gate-admission] refusing to start ${subject}: waited ${minutes} minutes for memory (${reason ? describeMemoryWait(reason) : 'no memory reading'})`
}

export interface RunAdmittedDeps {
  acquire?: typeof acquireQualityGateAdmission
  spawn?: typeof nodeSpawn
  startSampler?: typeof startPeakRssSampler
  warn?: (line: string) => void
  env?: NodeJS.ProcessEnv
  maxWaitMs?: number
}

type ChildResult = { code: number | null; signal: NodeJS.Signals | null } | { error: Error }

function runChild(
  spawn: typeof nodeSpawn,
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  onSpawn: (child: ChildProcess) => void,
): Promise<ChildResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, { cwd, env, stdio: 'inherit' })
    } catch (error) {
      resolve({ error: error instanceof Error ? error : new Error(String(error)) })
      return
    }
    const listeners = FORWARDED_SIGNALS.map((signal) => {
      const listener = () => { child.kill(signal) }
      process.on(signal, listener)
      return [signal, listener] as const
    })
    let settled = false
    const settle = (result: ChildResult) => {
      if (settled) return
      settled = true
      for (const [signal, listener] of listeners) process.off(signal, listener)
      resolve(result)
    }
    child.once('error', (error) => settle({ error }))
    child.once('exit', (code, signal) => settle({ code, signal }))
    onSpawn(child)
  })
}

function exitCodeOf(result: { code: number | null; signal: NodeJS.Signals | null }): number {
  if (result.code !== null) return result.code
  const signalNumber = result.signal ? constants.signals[result.signal] : undefined
  return signalNumber === undefined ? 1 : 128 + signalNumber
}

/** Run `command` under admission and resolve with the exit code the wrapper should use. */
export async function runAdmittedCommand(
  input: { footprintKey: string; command: string; args: string[]; cwd: string },
  deps: RunAdmittedDeps = {},
): Promise<number> {
  const { footprintKey, command, args, cwd } = input
  const env = deps.env ?? process.env
  const spawn = deps.spawn ?? nodeSpawn
  const startSampler = deps.startSampler ?? startPeakRssSampler
  const warn = deps.warn ?? ((line: string) => { process.stderr.write(`${line}\n`) })
  const maxWaitMs = deps.maxWaitMs ?? WRAPPER_MAX_WAIT_MS

  let handle: QualityGateAdmissionHandle | null = null
  if (!shouldBypassAdmission(env)) {
    try {
      handle = await (deps.acquire ?? acquireQualityGateAdmission)(
        { workspacePath: cwd, gateName: footprintKey, attempt: 1, footprintKey },
        { maxWaitMs, onWaiting: (reason) => warn(`[gate-admission] ${footprintKey} ${describeWait(reason)}`) },
      )
    } catch (error) {
      const memoryTimeout = memoryTimeoutOf(error)
      if (memoryTimeout) {
        warn(memoryRefusalMessage(footprintKey, maxWaitMs, memoryTimeout.reason))
        return EXIT_TEMPFAIL
      }
      warn(`[gate-admission] proceeding without admission: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const state: { sampler: PeakRssSampler | null } = { sampler: null }
  try {
    const childEnv = handle ? { ...env, OVERDECK_GATE_ADMITTED: '1' } : env
    const result = await runChild(spawn, command, args, cwd, childEnv, (child) => {
      if (handle && child.pid !== undefined) state.sampler = startSampler(child.pid)
    })
    const peak = state.sampler ? await state.sampler.stop() : null
    if ('error' in result) {
      warn(`[gate-admission] could not start ${command}: ${result.error.message}`)
      return 1
    }
    if (handle && result.code !== null && peak !== null) await handle.recordPeak(peak)
    return exitCodeOf(result)
  } finally {
    await state.sampler?.stop()
    await handle?.release()
  }
}
