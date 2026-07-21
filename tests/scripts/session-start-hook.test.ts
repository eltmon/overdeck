import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'session-start-hook')

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

function writeStubCurl(dir: string): void {
  const curl = `#!/bin/bash
printf '%s\n' "$@" >> "$CURL_LOG"
exit 0
`
  writeFileSync(join(dir, 'curl'), curl, 'utf-8')
  chmodSync(join(dir, 'curl'), 0o755)
}

function runHook(scriptDir: string, stdin: string, env: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(join(scriptDir, 'session-start-hook'), [], {
      env: {
        ...process.env,
        ...env,
        PATH: `${scriptDir}:${process.env.PATH ?? ''}`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
    child.on('error', () => resolve({ stdout, stderr, code: 1 }))
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe('session-start-hook compaction repair (PAN-2884)', () => {
  let tempDir: string
  let eventLog: string
  let curlLog: string
  let overdeckHome: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'overdeck-session-start-hook-'))
    eventLog = join(tempDir, 'events.log')
    curlLog = join(tempDir, 'curl.log')
    overdeckHome = join(tempDir, 'home')
    mkdirSync(overdeckHome, { recursive: true })

    writeFileSync(join(tempDir, 'session-start-hook'), readFileSync(SCRIPT_PATH, 'utf-8'), 'utf-8')
    chmodSync(join(tempDir, 'session-start-hook'), 0o755)
    writeStubHookLib(tempDir, eventLog)
    writeStubCurl(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('emits corrective context after compaction and preserves lifecycle side effects', async () => {
    const input = JSON.stringify({
      session_id: 'session-2884',
      model: 'gpt-5.6-sol',
      source: 'compact',
    })

    const { stdout, code } = await runHook(tempDir, input, {
      OVERDECK_AGENT_ID: 'agent-pan-2884',
      OVERDECK_HOME: overdeckHome,
      PAN_DASHBOARD_URL: 'http://dashboard.test',
      CURL_LOG: curlLog,
    })

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string
        additionalContext?: string
      }
    }
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('SessionStart')
    expect(parsed.hookSpecificOutput?.additionalContext).toContain('harness-only instructions')
    expect(parsed.hookSpecificOutput?.additionalContext).toContain('use tools normally')

    const events = readFileSync(eventLog, 'utf-8')
    expect(events).toContain('"kind":"activity","activity":"idle"')
    expect(events).toContain('"kind": "model_set"')
    expect(events).toContain('"model": "gpt-5.6-sol"')

    const ready = JSON.parse(readFileSync(join(overdeckHome, 'agents', 'agent-pan-2884', 'ready.json'), 'utf-8'))
    expect(ready).toMatchObject({
      ready: true,
      agentId: 'agent-pan-2884',
      sessionId: 'session-2884',
      reason: 'session-start',
    })

    const curlArgs = readFileSync(curlLog, 'utf-8')
    expect(curlArgs).toContain('http://dashboard.test/api/memory/session/start')
    expect(curlArgs).toContain('"source":"compact"')
    expect(curlArgs).toContain('"agentId":"agent-pan-2884"')
  })

  it.each([
    ['startup', { source: 'startup' }],
    ['resume', { source: 'resume' }],
    ['clear', { source: 'clear' }],
    ['missing source', {}],
  ])('emits no stdout context for %s SessionStart events', async (_label, source) => {
    const { stdout, code } = await runHook(tempDir, JSON.stringify({ session_id: 'session-2884', ...source }), {
      OVERDECK_AGENT_ID: 'agent-pan-2884',
      OVERDECK_HOME: overdeckHome,
      PAN_DASHBOARD_URL: 'http://dashboard.test',
      CURL_LOG: curlLog,
    })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})
