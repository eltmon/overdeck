import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'user-prompt-submit-hook')
const HOOK_LIB_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'pan-hook-lib.sh')

function writeStubHookLib(dir: string, eventLog: string): void {
  const lib = `${readFileSync(HOOK_LIB_PATH, 'utf-8')}
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

// Logs every call; the memory-inject endpoint answers with context the hook
// would print into the model's prompt.
function writeStubCurl(dir: string): void {
  const curl = `#!/bin/bash
printf '%s\\n' "$*" >> "$CURL_LOG"
case "$*" in
  */api/memory/inject*) printf '%s' '{"ok":true,"context":"<overdeck-memory-context>MEMCTX</overdeck-memory-context>"}' ;;
esac
exit 0
`
  writeFileSync(join(dir, 'curl'), curl, 'utf-8')
  chmodSync(join(dir, 'curl'), 0o755)
}

function runHook(scriptDir: string, stdin: string, env: Record<string, string>): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(join(scriptDir, 'user-prompt-submit-hook'), [], {
      env: { ...process.env, ...env, PATH: `${scriptDir}:${process.env.PATH ?? ''}` },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
    child.on('close', (code) => resolve({ stdout, code: code ?? 0 }))
    child.on('error', () => resolve({ stdout, code: 1 }))
    child.stdin.on('error', () => {})
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe('user-prompt-submit-hook bare conversations (PAN-4185)', () => {
  let tempDir: string
  let eventLog: string
  let curlLog: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'overdeck-ups-hook-'))
    eventLog = join(tempDir, 'events.log')
    curlLog = join(tempDir, 'curl.log')
    writeFileSync(join(tempDir, 'user-prompt-submit-hook'), readFileSync(SCRIPT_PATH, 'utf-8'), 'utf-8')
    chmodSync(join(tempDir, 'user-prompt-submit-hook'), 0o755)
    writeStubHookLib(tempDir, eventLog)
    writeStubCurl(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const input = JSON.stringify({ session_id: 'session-4185', prompt: 'hello there' })
  const baseEnv = (): Record<string, string> => ({
    OVERDECK_AGENT_ID: 'conv-4185',
    OVERDECK_DASHBOARD_URL: 'http://dashboard.test',
    OVERDECK_INTERNAL_TOKEN: 'test-token',
    CURL_LOG: curlLog,
  })

  it('injects retrieved memory context into a normal conversation', async () => {
    const { stdout, code } = await runHook(tempDir, input, baseEnv())
    expect(code).toBe(0)
    expect(stdout).toContain('MEMCTX')
    expect(readFileSync(curlLog, 'utf-8')).toContain('/api/memory/inject')
  })

  it('skips memory retrieval and injection when OVERDECK_BARE_CONTEXT=1, but still observes', async () => {
    const { stdout, code } = await runHook(tempDir, input, { ...baseEnv(), OVERDECK_BARE_CONTEXT: '1' })
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
    const curlArgs = existsSync(curlLog) ? readFileSync(curlLog, 'utf-8') : ''
    expect(curlArgs).not.toContain('/api/memory/inject')
    // Title capture and the activity events are observation, not context.
    expect(curlArgs).toContain('/api/hooks/user-prompt-submit')
    const events = readFileSync(eventLog, 'utf-8')
    expect(events).toContain('"kind":"waiting_clear"')
    expect(events).toContain('"kind":"message_received"')
    expect(events).toContain('"kind":"thinking_start"')
  })
})
