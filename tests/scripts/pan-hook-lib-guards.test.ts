import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
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

  it('rejects a second acquire while the recorded holder is alive', async () => {
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, 'pid'), `${process.pid}\n`, 'utf-8')

    const output = await runBash(
      'source "$LIB_PATH"; pan_acquire_singleflight_lock "$LOCK_DIR"; rc=$?; printf "rc=%s pid=%s" "$rc" "$(cat "$LOCK_DIR/pid")"',
      env(),
    )

    expect(output).toBe(`rc=1 pid=${process.pid}`)
    expect(readFileSync(join(lockDir, 'pid'), 'utf-8')).toBe(`${process.pid}\n`)
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

  it('releases an existing or already-absent lock idempotently', async () => {
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, 'pid'), `${process.pid}\n`, 'utf-8')

    const output = await runBash(
      'source "$LIB_PATH"; pan_release_singleflight_lock "$LOCK_DIR"; first=$?; pan_release_singleflight_lock "$LOCK_DIR"; second=$?; printf "first=%s second=%s" "$first" "$second"',
      env(),
    )

    expect(output).toBe('first=0 second=0')
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
    mkdirSync(rateLockDir, { recursive: true })
    writeFileSync(join(rateLockDir, 'pid'), `${process.pid}\n`, 'utf-8')
    writeFileSync(bucketFile, '12345\n', 'utf-8')

    const output = await runBash(
      'source "$LIB_PATH"; pan_llm_rate_check; printf "rc=%s" "$?"',
      { ...env(), OVERDECK_HOME: overdeckHome },
    )

    expect(output).toBe('rc=1')
    expect(readFileSync(bucketFile, 'utf-8')).toBe('12345\n')
  })
})
