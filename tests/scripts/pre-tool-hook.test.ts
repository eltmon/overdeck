import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PRE_TOOL_HOOK_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'pre-tool-hook')
const HEARTBEAT_HOOK_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'heartbeat-hook')
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
pan_append_session_index() {
  return 0
}
`
  writeFileSync(join(dir, 'pan-hook-lib.sh'), lib, 'utf-8')
  chmodSync(join(dir, 'pan-hook-lib.sh'), 0o755)
}

function writeHookScript(dir: string, name: string, sourcePath: string): void {
  writeFileSync(join(dir, name), readFileSync(sourcePath, 'utf-8'), 'utf-8')
  chmodSync(join(dir, name), 0o755)
}

function runHook(
  scriptDir: string,
  scriptName: string,
  stdin: string,
  env: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(join(scriptDir, scriptName), [], {
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
    // A hook that exits before reading stdin makes this write EPIPE; the exit code is the answer.
    child.stdin.on('error', () => {})
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

function readEmittedBody(eventLog: string): { tool?: string; toolDescription?: string; hookName?: string } {
  const raw = readFileSync(eventLog, 'utf-8')
  const pipeIndex = raw.indexOf('|')
  return JSON.parse(raw.slice(pipeIndex + 1)) as { tool?: string; toolDescription?: string; hookName?: string }
}

describe('hooks emit toolDescription with activity events (PAN-4222)', () => {
  let tempDir: string
  let eventLog: string
  let overdeckHome: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'overdeck-tool-description-hook-'))
    eventLog = join(tempDir, 'events.log')
    overdeckHome = join(tempDir, 'home')
    mkdirSync(overdeckHome, { recursive: true })

    writeHookScript(tempDir, 'pre-tool-hook', PRE_TOOL_HOOK_PATH)
    writeHookScript(tempDir, 'heartbeat-hook', HEARTBEAT_HOOK_PATH)
    writeStubHookLib(tempDir, eventLog)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('ac1: pre-tool-hook carries tool_input.description as toolDescription for Bash', async () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "WI-7"', description: 'Commit WI-7' },
    })

    const { stdout, code } = await runHook(tempDir, 'pre-tool-hook', input, {
      OVERDECK_AGENT_ID: 'agent-pan-4222',
      OVERDECK_HOME: overdeckHome,
    })

    expect(code).toBe(0)
    expect(stdout).toBe('')
    const body = readEmittedBody(eventLog)
    expect(body.tool).toBe('Bash')
    expect(body.toolDescription).toBe('Commit WI-7')
  })

  it('ac2: pre-tool-hook falls back to the file_path basename for Read', async () => {
    const input = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: '/a/b/live-model.ts' },
    })

    const { code } = await runHook(tempDir, 'pre-tool-hook', input, {
      OVERDECK_AGENT_ID: 'agent-pan-4222',
      OVERDECK_HOME: overdeckHome,
    })

    expect(code).toBe(0)
    const body = readEmittedBody(eventLog)
    expect(body.toolDescription).toBe('live-model.ts')
  })

  it('ac3: pre-tool-hook truncates a multi-line description to its first line, max 120 chars', async () => {
    const firstLine = 'x'.repeat(150)
    const description = `${firstLine}\nsecond line of the description that should never appear`
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'echo hi', description },
    })

    const { code } = await runHook(tempDir, 'pre-tool-hook', input, {
      OVERDECK_AGENT_ID: 'agent-pan-4222',
      OVERDECK_HOME: overdeckHome,
    })

    expect(code).toBe(0)
    const body = readEmittedBody(eventLog)
    expect(body.toolDescription).toBe(firstLine.slice(0, 120))
    expect(body.toolDescription).not.toContain('second line')
  })

  it('ac4: heartbeat-hook carries hookName PostToolUse and the same toolDescription', async () => {
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "WI-7"', description: 'Commit WI-7' },
    })

    const { code } = await runHook(tempDir, 'heartbeat-hook', input, {
      OVERDECK_AGENT_ID: 'agent-pan-4222',
      OVERDECK_HOME: overdeckHome,
    })

    expect(code).toBe(0)
    const body = readEmittedBody(eventLog)
    expect(body.hookName).toBe('PostToolUse')
    expect(body.toolDescription).toBe('Commit WI-7')
  })
})

/**
 * Runs the hook with an env built from scratch: this test itself runs inside a
 * managed session, so inheriting process.env would leak OVERDECK_AGENT_ID, TMUX
 * and the live OVERDECK_HOME into the "unmanaged" case. HOME is the temp dir so
 * nothing can touch the live ~/.overdeck.
 */
function runIsolatedHook(
  scriptDir: string,
  tempHome: string,
  stdin: string,
  extra: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(join(scriptDir, 'pre-tool-hook'), [], {
      env: {
        PATH: `${scriptDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        HOME: tempHome,
        OVERDECK_HOME: join(tempHome, '.overdeck'),
        OVERDECK_DASHBOARD_URL: 'http://127.0.0.1:9',
        ...extra,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }))
    child.on('error', () => resolve({ stdout, stderr, code: 1 }))
    child.stdin.on('error', () => {})
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe('shutdown deny (PAN-5342)', () => {
  let tempDir: string
  let tempHome: string
  let eventLog: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'overdeck-shutdown-deny-hook-'))
    tempHome = join(tempDir, 'home')
    eventLog = join(tempDir, 'events.log')
    mkdirSync(join(tempHome, '.overdeck'), { recursive: true })
    writeHookScript(tempDir, 'pre-tool-hook', PRE_TOOL_HOOK_PATH)
    // The real pan_resolve_agent_id stays in force; only the network emit is stubbed.
    writeFileSync(join(tempDir, 'pan-hook-lib.sh'), `${readFileSync(HOOK_LIB_PATH, 'utf-8')}
pan_emit_event() {
  echo "$1|$2" >> "${eventLog}"
}
`, 'utf-8')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls', description: 'List files' } })
  const startDrain = () => writeFileSync(join(tempHome, '.overdeck', 'shutdown.json'), '{"version":1}', 'utf-8')
  const emitted = () => existsSync(eventLog)

  it('denies the tool call of a managed session while the shutdown record exists', async () => {
    startDrain()
    const { stdout, code } = await runIsolatedHook(tempDir, tempHome, input, { OVERDECK_AGENT_ID: 'agent-x' })

    expect(code).toBe(0)
    const output = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason: string } }
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(output.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain('pan shutdown')
    expect(emitted()).toBe(false)
  })

  it('allows the tool call silently when no shutdown record exists', async () => {
    const { stdout, code } = await runIsolatedHook(tempDir, tempHome, input, { OVERDECK_AGENT_ID: 'agent-x' })

    expect(code).toBe(0)
    expect(stdout).toBe('')
    expect(emitted()).toBe(true)
  })

  it('leaves an unmanaged session (no OVERDECK_AGENT_ID, no TMUX) untouched even while draining', async () => {
    startDrain()
    const { stdout, code } = await runIsolatedHook(tempDir, tempHome, input, {})

    expect(code).toBe(0)
    expect(stdout).toBe('')
    expect(emitted()).toBe(false)
  })
})
