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

  it('extracts the hosted-server authorization URL (mcp.linear.app/authorize)', async () => {
    // The hosted Linear MCP server instructs with this exact shape — the
    // linear.app/oauth/authorize-only regex missed it and emitted required
    // with a null URL, leaving the banner stuck on "waiting" (2026-08-15).
    const authUrl = 'https://mcp.linear.app/authorize?response_type=code&client_id=test&state=abc&redirect_uri=http%3A%2F%2Flocalhost%3A3118%2Fcallback'

    const result = await runHook(
      tempDir,
      input('mcp__linear__authenticate', `Ask the user to open this URL in their browser to authorize the linear MCP server:\n\n${authUrl}\n\nOnce they complete the flow, the server's tools will become available automatically.`),
      environment(),
    )

    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' })
    expect(eventBodies(eventLog)).toEqual([{
      kind: 'linear_mcp_auth_required',
      authUrl,
    }])
    expect(existsSync(markerPath())).toBe(true)
  })

  it('emits required with a null URL for a real PostToolUseFailure auth error', async () => {
    // The documented failure-event shape: top-level `error` + `is_interrupt`,
    // no tool_response. PostToolUse does not fire for failed MCP calls at all.
    const failureInput = JSON.stringify({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'mcp__linear__list_issues',
      tool_input: {},
      error: 'MCP error 401: Unauthorized — Linear session requires authentication',
      is_interrupt: false,
    })

    await runHook(tempDir, failureInput, environment())

    expect(eventBodies(eventLog)).toEqual([
      {
        kind: 'hook_fired',
        hookName: 'PostToolUseFailure',
        tool: 'mcp__linear__list_issues',
      },
      {
        kind: 'linear_mcp_auth_required',
        authUrl: null,
      },
    ])
    expect(existsSync(markerPath())).toBe(true)
  })

  it('emits required for an error-shaped success payload carrying an auth error', async () => {
    await runHook(
      tempDir,
      input('mcp__linear__list_issues', { isError: true, error: '401 Unauthorized: not authenticated' }),
      environment(),
    )

    expect(eventBodies(eventLog)).toEqual([{
      kind: 'linear_mcp_auth_required',
      authUrl: null,
    }])
    expect(existsSync(markerPath())).toBe(true)
  })

  it('stays silent for a PostToolUseFailure that is not an auth error', async () => {
    const failureInput = JSON.stringify({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'mcp__linear__get_issue',
      tool_input: {},
      error: 'MCP error -40: issue MIN-401 not found',
      is_interrupt: false,
    })

    const result = await runHook(tempDir, failureInput, environment())

    expect(result.code).toBe(0)
    expect(eventBodies(eventLog)).toEqual([{
      kind: 'hook_fired',
      hookName: 'PostToolUseFailure',
      tool: 'mcp__linear__get_issue',
    }])
    expect(existsSync(markerPath())).toBe(false)
  })

  it('never auth-classifies successful issue data containing 401s or "unauthorized"', async () => {
    // Regression: ordinary Linear payloads legitimately contain identifiers
    // like MIN-401 and prose about 401/unauthorized behavior — none of that is
    // MCP authentication state, and a successful call must clear a pending
    // intervention instead of raising a false one.
    mkdirSync(join(overdeckHome, 'agents', agentId), { recursive: true })
    writeFileSync(markerPath(), '')

    await runHook(
      tempDir,
      input('mcp__linear__list_issues', {
        issues: [
          { identifier: 'MIN-401', title: 'Retry after a 401 response' },
          { identifier: 'MIN-402', title: 'Mark legacy tokens unauthorized in docs' },
        ],
      }),
      environment(),
    )

    expect(eventBodies(eventLog)).toEqual([{ kind: 'linear_mcp_auth_healthy' }])
    expect(existsSync(markerPath())).toBe(false)
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
