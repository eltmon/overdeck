import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'notification-hook')

function writeStubHookLib(dir: string, eventLog: string): void {
  const lib = `#!/bin/bash
set +e
pan_resolve_agent_id() {
  AGENT_ID="\${OVERDECK_AGENT_ID:-}"
  [ -n "$AGENT_ID" ]
}
pan_emit_event() {
  echo "$1|$2" >> "${eventLog}"
}
`
  writeFileSync(join(dir, 'pan-hook-lib.sh'), lib, 'utf-8')
  chmodSync(join(dir, 'pan-hook-lib.sh'), 0o755)
}

function runHook(scriptDir: string, stdin: string, env: Record<string, string>): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(join(scriptDir, 'notification-hook'), [], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.on('close', (code) => resolve({ code: code ?? 0 }))
    child.on('error', () => resolve({ code: 1 }))
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe('notification-hook classification', () => {
  let tempDir: string
  let eventLog: string
  let fakeHome: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'notification-hook-'))
    eventLog = join(tempDir, 'events.log')
    fakeHome = join(tempDir, 'home')
    copyFileSync(SCRIPT_PATH, join(tempDir, 'notification-hook'))
    chmodSync(join(tempDir, 'notification-hook'), 0o755)
    writeStubHookLib(tempDir, eventLog)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const run = (message: string) =>
    runHook(tempDir, JSON.stringify({ message }), {
      OVERDECK_AGENT_ID: 'agent-pan-9999',
      HOME: fakeHome,
    })

  it('does NOT emit for the idle-timeout heartbeat "Claude is waiting for your input"', async () => {
    // Claude Code fires this for any agent idle >60s — after a completed turn,
    // between items, or when work is done. Classifying it as user_question
    // painted every long-idle agent as a blocking "Question for you" decision
    // with no question content (seen on PAN-3253).
    await run('Claude is waiting for your input')
    expect(existsSync(eventLog)).toBe(false)
  })

  it('idle-heartbeat exclusion is case-insensitive and exact', async () => {
    await run('CLAUDE IS WAITING FOR YOUR INPUT')
    expect(existsSync(eventLog)).toBe(false)
  })

  it('still emits user_question for a message that carries actual question text', async () => {
    await run('Claude is waiting for your answer to a question about the schema')
    const log = readFileSync(eventLog, 'utf-8')
    expect(log).toContain('agent-pan-9999|')
    expect(log).toContain('"reason": "user_question"')
  })

  it('still emits tool_permission for permission prompts', async () => {
    await run('Claude needs your permission to use Bash')
    const log = readFileSync(eventLog, 'utf-8')
    expect(log).toContain('"reason": "tool_permission"')
  })

  it('emits nothing for an unclassified message', async () => {
    await run('Task completed successfully')
    expect(existsSync(eventLog)).toBe(false)
  })
})
