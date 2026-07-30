import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const LIB_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'pan-hook-lib.sh')

async function runBash(script: string, env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync('bash', ['-c', script], { env })
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
})
