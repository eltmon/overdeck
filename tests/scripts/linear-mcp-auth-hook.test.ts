import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'linear-mcp-auth-hook')

function writeStubHookLib(dir: string, eventLog: string): void {
  const lib = `#!/bin/bash
set +e
pan_resolve_agent_id() {
  AGENT_ID="\${OVERDECK_AGENT_ID:-}"
  [ -n "$AGENT_ID" ]
}
pan_emit_event() {
  printf '%s\\t%s\\n' "$1" "$(printf '%s' "$2" | jq -c .)" >> "${eventLog}"
}
`
  writeFileSync(join(dir, 'pan-hook-lib.sh'), lib, 'utf-8')
  chmodSync(join(dir, 'pan-hook-lib.sh'), 0o755)
}

function runHook(
  scriptDir: string,
  stdin: string,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(join(scriptDir, 'linear-mcp-auth-hook'), [], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
    child.on('close', code => resolve({ stdout, stderr, code: code ?? 0 }))
    child.on('error', () => resolve({ stdout, stderr, code: 1 }))
    if (stdin) child.stdin.write(stdin)
    child.stdin.end()
  })
}

function eventBodies(eventLog: string): Array<Record<string, unknown>> {
  if (!existsSync(eventLog)) return []
  return readFileSync(eventLog, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line.split('\t')[1] ?? '{}') as Record<string, unknown>)
}

describe('linear-mcp-auth-hook', () => {
  let tempDir: string
  let eventLog: string
  let overdeckHome: string
  const agentId = 'agent-min-852'

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'overdeck-linear-mcp-hook-'))
    eventLog = join(tempDir, 'events.log')
    overdeckHome = join(tempDir, 'home')
    mkdirSync(tempDir, { recursive: true })
    writeFileSync(join(tempDir, 'linear-mcp-auth-hook'), readFileSync(SCRIPT_PATH, 'utf-8'), 'utf-8')
    chmodSync(join(tempDir, 'linear-mcp-auth-hook'), 0o755)
    writeStubHookLib(tempDir, eventLog)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  function markerPath(): string {
    return join(overdeckHome, 'agents', agentId, 'linear-mcp-auth-pending')
  }

  function input(toolName: string, toolResponse: unknown): string {
    return JSON.stringify({ tool_name: toolName, tool_response: toolResponse })
  }

  function environment(extra: Record<string, string> = {}): Record<string, string> {
    return {
      OVERDECK_AGENT_ID: agentId,
      OVERDECK_HOME: overdeckHome,
      PATH: process.env.PATH ?? '',
      ...extra,
    }
  }

  it('extracts the authorization URL from authenticate and emits required', async () => {
    const authUrl = 'https://linear.app/oauth/authorize?client_id=test&state=abc'

    const result = await runHook(
      tempDir,
      input('mcp__linear__authenticate', `Authorize Linear by opening ${authUrl}`),
      environment(),
    )

    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' })
    expect(eventBodies(eventLog)).toEqual([{
      kind: 'linear_mcp_auth_required',
      authUrl,
    }])
    expect(existsSync(markerPath())).toBe(true)
  })

  it('emits required with a null URL for an auth error from any Linear tool', async () => {
    await runHook(
      tempDir,
      input('mcp__linear__list_issues', { error: '401 Unauthorized: not authenticated' }),
      environment(),
    )

    expect(eventBodies(eventLog)).toEqual([{
      kind: 'linear_mcp_auth_required',
      authUrl: null,
    }])
    expect(existsSync(markerPath())).toBe(true)
  })

  it('emits healthy and deletes the marker after complete_authentication succeeds', async () => {
    mkdirSync(join(overdeckHome, 'agents', agentId), { recursive: true })
    writeFileSync(markerPath(), '')

    await runHook(
      tempDir,
      input('mcp__linear__complete_authentication', { success: true }),
      environment(),
    )

    expect(eventBodies(eventLog)).toEqual([{ kind: 'linear_mcp_auth_healthy' }])
    expect(existsSync(markerPath())).toBe(false)
  })

  it('emits healthy after any successful Linear call only when the marker exists', async () => {
    await runHook(
      tempDir,
      input('mcp__linear__list_issues', { issues: [] }),
      environment(),
    )
    expect(eventBodies(eventLog)).toEqual([])

    mkdirSync(join(overdeckHome, 'agents', agentId), { recursive: true })
    writeFileSync(markerPath(), '')
    await runHook(
      tempDir,
      input('mcp__linear__list_issues', { issues: [] }),
      environment(),
    )

    expect(eventBodies(eventLog)).toEqual([{ kind: 'linear_mcp_auth_healthy' }])
    expect(existsSync(markerPath())).toBe(false)
  })

  it('exits 0 silently for malformed stdin', async () => {
    const result = await runHook(tempDir, 'not-json-{', environment())

    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' })
    expect(eventBodies(eventLog)).toEqual([])
  })

  it('exits 0 silently when jq is unavailable', async () => {
    const result = await runHook(
      tempDir,
      input('mcp__linear__authenticate', 'response'),
      environment({ PATH: '' }),
    )

    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' })
    expect(eventBodies(eventLog)).toEqual([])
  })
})
