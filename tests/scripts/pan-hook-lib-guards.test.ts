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

describe('pan-hook-lib guard primitives', () => {
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

  it('acquires an absent lock and records the caller PID', async () => {
    const output = await runBash(
      'source "$LIB_PATH"; pan_acquire_singleflight_lock "$LOCK_DIR"; printf "pid=%s self=%s" "$(cat "$LOCK_DIR/pid")" "$$"',
      env(),
    )

    const match = output.match(/^pid=(\d+) self=(\d+)$/)
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe(match?.[2])
    expect(existsSync(lockDir)).toBe(true)
  })

  it('rejects a second acquire while the kernel lock holder is alive', async () => {
    const readyFile = join(tempRoot, 'holder-ready')
    const releaseFile = join(tempRoot, 'release-holder')
    const holder = startBash(
      `source "$LIB_PATH"
pan_acquire_singleflight_lock "$LOCK_DIR" || exit 2
: > "$READY_FILE"
while [ ! -f "$RELEASE_FILE" ]; do /bin/sleep 0.01; done
pan_release_singleflight_lock "$LOCK_DIR"`,
      { ...env(), READY_FILE: readyFile, RELEASE_FILE: releaseFile },
    )
    await waitForFile(readyFile)
    const holderPid = readFileSync(join(lockDir, 'pid'), 'utf-8')

    const output = await runBash(
      'source "$LIB_PATH"; pan_acquire_singleflight_lock "$LOCK_DIR"; rc=$?; printf "rc=%s pid=%s" "$rc" "$(cat "$LOCK_DIR/pid")"',
      env(),
    )

    expect(output).toBe(`rc=1 pid=${holderPid.trim()}`)
    expect(readFileSync(join(lockDir, 'pid'), 'utf-8')).toBe(holderPid)
    writeFileSync(releaseFile, '', 'utf-8')
    expect((await holder.result).code).toBe(0)
  })

  it('does not reclaim a holder paused before owner metadata publication', async () => {
    const pausedFile = join(tempRoot, 'holder-paused')
    const resumeFile = join(tempRoot, 'resume-holder')
    const holder = startBash(
      `source "$LIB_PATH"
mkdir() {
  command mkdir "$@"
  rc=$?
  if [ "$rc" -eq 0 ] && [ "\${1:-}" = "$LOCK_DIR" ]; then
    : > "$PAUSED_FILE"
    while [ ! -f "$RESUME_FILE" ]; do /bin/sleep 0.01; done
  fi
  return "$rc"
}
pan_acquire_singleflight_lock "$LOCK_DIR"
rc=$?
[ "$rc" -eq 0 ] && pan_release_singleflight_lock "$LOCK_DIR"
exit "$rc"`,
      { ...env(), PAUSED_FILE: pausedFile, RESUME_FILE: resumeFile },
    )
    await waitForFile(pausedFile)
    expect(existsSync(join(lockDir, 'pid'))).toBe(false)

    const contender = await runBash(
      'source "$LIB_PATH"; pan_acquire_singleflight_lock "$LOCK_DIR"; printf "rc=%s" "$?"',
      env(),
    )

    expect(contender).toBe('rc=1')
    writeFileSync(resumeFile, '', 'utf-8')
    const holderResult = await holder.result
    expect(holderResult.code).toBe(0)
    expect(holderResult.stderr).toBe('')
  })

  it('does not let a non-owner release an active lock', async () => {
    const readyFile = join(tempRoot, 'owner-ready')
    const releaseFile = join(tempRoot, 'release-owner')
    const holder = startBash(
      `source "$LIB_PATH"
pan_acquire_singleflight_lock "$LOCK_DIR" || exit 2
: > "$READY_FILE"
while [ ! -f "$RELEASE_FILE" ]; do /bin/sleep 0.01; done
pan_release_singleflight_lock "$LOCK_DIR"`,
      { ...env(), READY_FILE: readyFile, RELEASE_FILE: releaseFile },
    )
    await waitForFile(readyFile)
    const holderPid = readFileSync(join(lockDir, 'pid'), 'utf-8')

    const output = await runBash(
      'source "$LIB_PATH"; pan_release_singleflight_lock "$LOCK_DIR"; released=$?; pan_acquire_singleflight_lock "$LOCK_DIR"; acquired=$?; printf "released=%s acquired=%s pid=%s" "$released" "$acquired" "$(cat "$LOCK_DIR/pid")"',
      env(),
    )

    expect(output).toBe(`released=0 acquired=1 pid=${holderPid.trim()}`)
    writeFileSync(releaseFile, '', 'utf-8')
    expect((await holder.result).code).toBe(0)
  })

  it.each([
    ['dead holder', '99999999'],
    ['missing pid file', null],
  ])('reclaims a stale lock with a %s', async (_label, holderPid) => {
    mkdirSync(lockDir)
    if (holderPid !== null) {
      writeFileSync(join(lockDir, 'pid'), `${holderPid}\n`, 'utf-8')
    }

    const output = await runBash(
      'source "$LIB_PATH"; pan_acquire_singleflight_lock "$LOCK_DIR"; printf "pid=%s self=%s" "$(cat "$LOCK_DIR/pid")" "$$"',
      env(),
    )

    const match = output.match(/^pid=(\d+) self=(\d+)$/)
    expect(match).not.toBeNull()
    expect(match?.[1]).toBe(match?.[2])
  })

  it('releases an owned or already-absent lock idempotently', async () => {
    const output = await runBash(
      'source "$LIB_PATH"; pan_acquire_singleflight_lock "$LOCK_DIR"; acquired=$?; pan_release_singleflight_lock "$LOCK_DIR"; first=$?; pan_release_singleflight_lock "$LOCK_DIR"; second=$?; printf "acquired=%s first=%s second=%s" "$acquired" "$first" "$second"',
      env(),
    )

    expect(output).toBe('acquired=0 first=0 second=0')
    expect(existsSync(lockDir)).toBe(false)
  })

  it('preserves stdout and the wrapped command exit code', async () => {
    const output = await runBash(
      `source "$LIB_PATH"
result=$(pan_run_with_timeout 5 bash -c 'printf "alpha\\nbeta\\n"; exit 7')
rc=$?
printf '%s\\nrc=%s' "$result" "$rc"`,
      env(),
    )

    expect(output).toBe('alpha\nbeta\nrc=7')
  })

  it('returns 124 before the deadline and kills the timed-out child', async () => {
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

  it('passes piped stdin through to the wrapped command', async () => {
    const output = await runBash(
      `source "$LIB_PATH"
printf 'hi\\n' | pan_run_with_timeout 5 /bin/cat`,
      env(),
    )

    expect(output).toBe('hi')
  })

  it('uses the pure-bash fallback when timeout commands are absent', async () => {
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

  it('records the first allowed LLM call in an empty bucket', async () => {
    const overdeckHome = join(tempRoot, 'overdeck-home')
    const bucketFile = join(overdeckHome, 'hook-llm-calls.log')

    const output = await runBash(
      'source "$LIB_PATH"; pan_llm_rate_check; printf "rc=%s" "$?"',
      { ...env(), OVERDECK_HOME: overdeckHome },
    )

    expect(output).toBe('rc=0')
    const timestamps = readFileSync(bucketFile, 'utf-8').trim().split('\n')
    expect(timestamps).toHaveLength(1)
    expect(timestamps[0]).toMatch(/^\d+$/)
  })

  it('rejects a call when the bucket already contains the limit', async () => {
    const overdeckHome = join(tempRoot, 'overdeck-home')
    const bucketFile = join(overdeckHome, 'hook-llm-calls.log')
    mkdirSync(overdeckHome)
    const now = Math.floor(Date.now() / 1000)
    const original = `${now}\n${now}\n${now}\n`
    writeFileSync(bucketFile, original, 'utf-8')

    const output = await runBash(
      'source "$LIB_PATH"; pan_llm_rate_check; printf "rc=%s" "$?"',
      {
        ...env(),
        OVERDECK_HOME: overdeckHome,
        OVERDECK_HOOK_LLM_RATE_LIMIT: '3',
      },
    )

    expect(output).toBe('rc=1')
    expect(readFileSync(bucketFile, 'utf-8')).toBe(original)
  })

  it('prunes timestamps older than the rolling window before allowing a call', async () => {
    const overdeckHome = join(tempRoot, 'overdeck-home')
    const bucketFile = join(overdeckHome, 'hook-llm-calls.log')
    mkdirSync(overdeckHome)
    const staleTimestamp = Math.floor(Date.now() / 1000) - 61
    writeFileSync(bucketFile, `${staleTimestamp}\n`, 'utf-8')

    const output = await runBash(
      'source "$LIB_PATH"; pan_llm_rate_check; printf "rc=%s" "$?"',
      { ...env(), OVERDECK_HOME: overdeckHome },
    )

    expect(output).toBe('rc=0')
    const timestamps = readFileSync(bucketFile, 'utf-8').trim().split('\n')
    expect(timestamps).toHaveLength(1)
    expect(Number.parseInt(timestamps[0] ?? '0', 10)).toBeGreaterThan(staleTimestamp)
  })

  it('fails closed without changing the bucket when its live lock cannot be acquired', async () => {
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
