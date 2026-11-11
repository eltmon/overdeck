// Wall-clock cases for sync-sources/hooks/pan-hook-lib.sh (PAN-5117). They run real bash sleeps and deadlines, so vitest.config.ts excludes this file from the default run. Run it with: VITEST_INCLUDE_SLOW=1 npx vitest run tests/scripts/pan-hook-lib-guards.slow.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const LIB_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'pan-hook-lib.sh')

async function runBash(script: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('/bin/bash', ['-c', script], { env })
  return stdout.trim()
}

function startBash(script: string, env: NodeJS.ProcessEnv): {
  result: Promise<{ code: number | null; stdout: string; stderr: string }>
} {
  const child = spawn('/bin/bash', ['-c', script], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  return {
    result: new Promise(resolve => {
      child.on('close', code => resolve({ code, stdout, stderr }))
    }),
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('pan-hook-lib wall-clock guards', () => {
  let tempRoot: string
  let lockDir: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pan-hook-guards-'))
    lockDir = join(tempRoot, 'singleflight.lock.d')
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  function env(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      LIB_PATH,
      LOCK_DIR: lockDir,
    }
  }

  it('returns 124 before the deadline and kills the timed-out child', { timeout: 20_000 }, async () => {
    const pidFile = join(tempRoot, 'timed-out.pid')
    const startedAt = Date.now()
    const output = await runBash(
      `source "$LIB_PATH"
pan_run_with_timeout 1 /bin/bash -c 'printf "%s\\n" "$$" > "$PID_FILE"; exec /bin/sleep 3'
rc=$?
printf 'rc=%s' "$rc"`,
      { ...env(), PID_FILE: pidFile },
    )

    expect(output).toBe('rc=124')
    expect(Date.now() - startedAt).toBeLessThan(2_500)
    const childPid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim(), 10)
    expect(() => process.kill(childPid, 0)).toThrow()
  })

  it('uses the pure-bash fallback when timeout commands are absent', { timeout: 20_000 }, async () => {
    const emptyPath = join(tempRoot, 'empty-path')
    const pidFile = join(tempRoot, 'fallback-timeout.pid')
    mkdirSync(emptyPath)

    const startedAt = Date.now()
    const output = await runBash(
      `source "$LIB_PATH"
pan_run_with_timeout 1 /bin/bash -c 'printf "%s\\n" "$$" > "$PID_FILE"; exec /bin/sleep 3'
rc=$?
printf 'rc=%s' "$rc"`,
      {
        ...env(),
        HOME: tempRoot,
        PATH: emptyPath,
        PID_FILE: pidFile,
      },
    )

    expect(output).toBe('rc=124')
    expect(Date.now() - startedAt).toBeLessThan(2_500)
    const childPid = Number.parseInt(readFileSync(pidFile, 'utf-8').trim(), 10)
    expect(() => process.kill(childPid, 0)).toThrow()
  })

  it('fails closed without changing the bucket when its live lock cannot be acquired', { timeout: 20_000 }, async () => {
    const overdeckHome = join(tempRoot, 'overdeck-home')
    const bucketFile = join(overdeckHome, 'hook-llm-calls.log')
    const rateLockDir = join(overdeckHome, 'hook-llm-calls.lock.d')
    const readyFile = join(tempRoot, 'rate-holder-ready')
    const releaseFile = join(tempRoot, 'release-rate-holder')
    mkdirSync(overdeckHome)
    writeFileSync(bucketFile, '12345\n', 'utf-8')
    const holder = startBash(
      `source "$LIB_PATH"
pan_acquire_singleflight_lock "$RATE_LOCK_DIR" || exit 2
: > "$READY_FILE"
while [ ! -f "$RELEASE_FILE" ]; do /bin/sleep 0.01; done
pan_release_singleflight_lock "$RATE_LOCK_DIR"`,
      {
        ...env(),
        RATE_LOCK_DIR: rateLockDir,
        READY_FILE: readyFile,
        RELEASE_FILE: releaseFile,
      },
    )
    await waitForFile(readyFile)

    const output = await runBash(
      'source "$LIB_PATH"; pan_llm_rate_check; printf "rc=%s" "$?"',
      { ...env(), OVERDECK_HOME: overdeckHome },
    )

    expect(output).toBe('rc=1')
    expect(readFileSync(bucketFile, 'utf-8')).toBe('12345\n')
    writeFileSync(releaseFile, '', 'utf-8')
    expect((await holder.result).code).toBe(0)
  })
})
