import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'work-agent-stop-hook')
const HOOK_LIB_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'pan-hook-lib.sh')
const AGENT_ID = 'agent-pan-986'

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8')
  chmodSync(path, 0o755)
}

describe('work-agent-stop-hook structured channel replies', () => {
  let tempRoot: string
  let homeDir: string
  let mockBin: string
  let heartbeatLog: string
  let tmuxLog: string
  let claudeLog: string
  let curlLog: string
  let runtimeJson: string
  let reviewStatusJson: string
  let hookScriptPath: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pan986-stop-hook-'))
    homeDir = join(tempRoot, 'home')
    mockBin = join(tempRoot, 'bin')
    heartbeatLog = join(tempRoot, 'heartbeat.log')
    tmuxLog = join(tempRoot, 'tmux.log')
    claudeLog = join(tempRoot, 'claude.log')
    curlLog = join(tempRoot, 'curl.log')
    runtimeJson = join(tempRoot, 'runtime.json')
    reviewStatusJson = join(tempRoot, 'review-status-api.json')
    hookScriptPath = join(tempRoot, 'work-agent-stop-hook')

    mkdirSync(homeDir, { recursive: true })
    mkdirSync(mockBin, { recursive: true })
    mkdirSync(join(homeDir, '.overdeck', 'agents', AGENT_ID), { recursive: true })
    writeFileSync(
      reviewStatusJson,
      JSON.stringify({
        issueId: 'PAN-986',
        reviewStatus: 'pending',
        testStatus: 'pending',
        mergeStatus: 'pending',
        readyForMerge: false,
        updatedAt: '2026-05-07T14:40:00.000Z',
      }),
      'utf-8',
    )

    writeFileSync(hookScriptPath, readFileSync(SCRIPT_PATH, 'utf-8'), 'utf-8')
    chmodSync(hookScriptPath, 0o755)
    writeFileSync(join(tempRoot, 'pan-hook-lib.sh'), readFileSync(HOOK_LIB_PATH, 'utf-8'), 'utf-8')
    chmodSync(join(tempRoot, 'pan-hook-lib.sh'), 0o755)

    writeExecutable(
      join(mockBin, 'curl'),
      `#!/bin/bash
set -euo pipefail
args="$*"
printf '%s\n' "$args" >> "$MOCK_CURL_LOG"
if [[ "$args" == *"/runtime"* ]]; then
  cat "$MOCK_RUNTIME_JSON"
  exit 0
fi
if [[ "$args" == *"/api/review/"*"/status"* ]]; then
  cat "$MOCK_REVIEW_STATUS_JSON"
  exit 0
fi
if [[ "$args" == *"/heartbeat"* ]]; then
  data=""
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--data" ]; then
      data="$arg"
      break
    fi
    prev="$arg"
  done
  printf '%s\n' "$data" >> "$MOCK_HEARTBEAT_LOG"
  printf '200'
  exit 0
fi
exit 1
`,
    )

    writeExecutable(
      join(mockBin, 'tmux'),
      `#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_TMUX_LOG"
if [ "\${1:-}" = "capture-pane" ]; then
  if [ -n "\${MOCK_TMUX_CAPTURE_OUTPUT:-}" ]; then
    printf '%s\n' "$MOCK_TMUX_CAPTURE_OUTPUT"
    exit 0
  fi
  echo 'capture-pane should not be called for structured channel replies' >&2
  exit 99
fi
exit 0
`,
    )

    writeExecutable(
      join(mockBin, 'claude'),
      `#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_CLAUDE_LOG"
[ -n "\${MOCK_CLAUDE_SLEEP:-}" ] && /bin/sleep "$MOCK_CLAUDE_SLEEP"
if [ -n "\${MOCK_CLAUDE_RESULT:-}" ]; then
  printf '%s\n' "$MOCK_CLAUDE_RESULT"
  exit "\${MOCK_CLAUDE_RC:-0}"
fi
exit 99
`,
    )
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  function hookEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HOME: homeDir,
      OVERDECK_HOME: join(homeDir, '.overdeck'),
      PATH: `${mockBin}:${process.env.PATH ?? ''}`,
      OVERDECK_AGENT_ID: AGENT_ID,
      OVERDECK_DASHBOARD_URL: 'http://mocked-dashboard.local',
      MOCK_RUNTIME_JSON: runtimeJson,
      MOCK_REVIEW_STATUS_JSON: reviewStatusJson,
      MOCK_HEARTBEAT_LOG: heartbeatLog,
      MOCK_TMUX_LOG: tmuxLog,
      MOCK_CLAUDE_LOG: claudeLog,
      MOCK_CURL_LOG: curlLog,
    }
  }

  async function runHook(replyKind: 'done' | 'needs_input', summary: string): Promise<void> {
    writeFileSync(
      runtimeJson,
      JSON.stringify({
        success: true,
        snapshot: {
          id: AGENT_ID,
          activity: 'idle',
          lastActivity: '2026-05-07T14:40:00.000Z',
          channelReply: {
            kind: replyKind,
            summary,
            artifactRefs: [],
            reportedAt: '2026-05-07T14:40:00.000Z',
          },
          updatedAtSequence: 12,
        },
      }),
      'utf-8',
    )

    await execFileAsync('bash', [hookScriptPath], {
      env: hookEnv(),
      timeout: 10_000,
    })
  }

  it('uses channel_reply done without pane scrape or claude fallback', async () => {
    await runHook('done', 'Implementation complete')

    expect(readFileSync(heartbeatLog, 'utf-8')).toContain('"resolution":"done"')
    expect(readFileSync(tmuxLog, 'utf-8')).not.toContain('capture-pane')
    expect(existsSync(claudeLog)).toBe(false)
  })

  it('uses channel_reply needs_input without pane scrape or claude fallback', async () => {
    await runHook('needs_input', 'Need user answer')

    expect(readFileSync(heartbeatLog, 'utf-8')).toContain('"resolution":"needs_input"')
    expect(existsSync(tmuxLog)).toBe(false)
    expect(existsSync(claudeLog)).toBe(false)
  })

  it('normalizes structured reply summaries before writing hooks.log', async () => {
    await runHook('done', 'Line 1\n\t[31mLine 2[0m\rFORGED')

    const hooksLog = readFileSync(join(homeDir, '.overdeck', 'logs', 'hooks.log'), 'utf-8')
    expect(hooksLog).toContain('summary=Line 1 Line 2 FORGED')
    expect(hooksLog).not.toContain('\n\t[31m')
  })

  it('reuses fetched runtime snapshot when emitting structured reply resolution', async () => {
    await runHook('done', 'Implementation complete')

    const runtimeRequests = readFileSync(curlLog, 'utf-8')
      .split('\n')
      .filter(line => line.includes('/runtime'))
    expect(runtimeRequests).toHaveLength(1)
  })

  it('uses the API-backed review status instead of stale review-status.json for active pipeline detection', async () => {
    writeFileSync(join(homeDir, '.overdeck', 'review-status.json'), '{}', 'utf-8')
    writeFileSync(
      reviewStatusJson,
      JSON.stringify({
        issueId: 'PAN-986',
        reviewStatus: 'passed',
        testStatus: 'passed',
        mergeStatus: 'queued',
        readyForMerge: true,
        updatedAt: '2026-05-07T14:40:00.000Z',
      }),
      'utf-8',
    )

    await execFileAsync('bash', [hookScriptPath], {
      env: hookEnv(),
      timeout: 10_000,
    })

    const curlRequests = readFileSync(curlLog, 'utf-8')
    expect(curlRequests).toContain('/api/review/PAN-986/status')
    const hooksLog = readFileSync(join(homeDir, '.overdeck', 'logs', 'hooks.log'), 'utf-8')
    expect(hooksLog).toContain('skipped — actively in specialist pipeline')
    expect(existsSync(heartbeatLog)).toBe(false)
    expect(existsSync(claudeLog)).toBe(false)
  })

  function writeFallbackRuntime(): void {
    writeFileSync(
      runtimeJson,
      JSON.stringify({
        success: true,
        snapshot: {
          id: AGENT_ID,
          activity: 'idle',
          lastActivity: '2026-05-07T14:40:00.000Z',
          updatedAtSequence: 12,
        },
      }),
      'utf-8',
    )
  }

  function fallbackEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...hookEnv(),
      MOCK_TMUX_CAPTURE_OUTPUT: 'Implementation complete\n❯',
      MOCK_CLAUDE_RESULT: 'FORGOT_COMPLETION',
      ...overrides,
    }
  }

  it('allows only one concurrent hook instance to reach external work', async () => {
    writeFallbackRuntime()
    const env = fallbackEnv({ MOCK_CLAUDE_SLEEP: '1' })

    const results = await Promise.all([
      execFileAsync('bash', [hookScriptPath], { env, timeout: 10_000 }),
      execFileAsync('bash', [hookScriptPath], { env, timeout: 10_000 }),
    ])

    expect(results).toHaveLength(2)
    expect(readFileSync(claudeLog, 'utf-8').trim().split('\n')).toHaveLength(1)
    const curlRequests = readFileSync(curlLog, 'utf-8').trim().split('\n')
    expect(curlRequests.filter(line => line.includes('/api/review/PAN-986/status'))).toHaveLength(1)
    expect(curlRequests.filter(line => line.includes('/runtime'))).toHaveLength(2)
    const tmuxRequests = readFileSync(tmuxLog, 'utf-8').trim().split('\n')
    expect(tmuxRequests.filter(line => line.startsWith('capture-pane'))).toHaveLength(1)

    const hooksLog = readFileSync(join(homeDir, '.overdeck', 'logs', 'hooks.log'), 'utf-8')
    expect(hooksLog).toContain('skipped — another instance holds')
    expect(existsSync(join(homeDir, '.overdeck', 'agents', AGENT_ID, 'stop-hook.lock.d'))).toBe(false)
  })

  it('reclaims a dead holder lock before running the completion check', async () => {
    writeFallbackRuntime()
    const lockDir = join(homeDir, '.overdeck', 'agents', AGENT_ID, 'stop-hook.lock.d')
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, 'pid'), '99999999\n', 'utf-8')

    await execFileAsync('bash', [hookScriptPath], {
      env: fallbackEnv(),
      timeout: 10_000,
    })

    expect(readFileSync(claudeLog, 'utf-8')).toContain('claude-haiku-4-5')
    expect(existsSync(lockDir)).toBe(false)
  })

  it('drops a timed-out completion check without emitting a resolution', async () => {
    writeFallbackRuntime()
    const startedAt = Date.now()

    await execFileAsync('bash', [hookScriptPath], {
      env: fallbackEnv({
        MOCK_CLAUDE_SLEEP: '3',
        OVERDECK_HOOK_LLM_TIMEOUT: '1',
      }),
      timeout: 10_000,
    })

    expect(Date.now() - startedAt).toBeLessThan(2_500)
    expect(existsSync(heartbeatLog)).toBe(false)
    const hooksLog = readFileSync(join(homeDir, '.overdeck', 'logs', 'hooks.log'), 'utf-8')
    expect(hooksLog).toContain('completion-check LLM timed out')
  })

  it('drops a rate-limited completion check before invoking claude', async () => {
    writeFallbackRuntime()
    const bucketFile = join(homeDir, '.overdeck', 'hook-llm-calls.log')
    const now = Math.floor(Date.now() / 1000)
    writeFileSync(bucketFile, `${now}\n`.repeat(6), 'utf-8')

    await execFileAsync('bash', [hookScriptPath], {
      env: fallbackEnv(),
      timeout: 10_000,
    })

    expect(existsSync(claudeLog)).toBe(false)
    expect(existsSync(heartbeatLog)).toBe(false)
    const hooksLog = readFileSync(join(homeDir, '.overdeck', 'logs', 'hooks.log'), 'utf-8')
    expect(hooksLog).toContain('rate-limited — skipping completion-check LLM')
  })

  it('records an admitted LLM call and preserves the completion resolution path', async () => {
    writeFallbackRuntime()
    const bucketFile = join(homeDir, '.overdeck', 'hook-llm-calls.log')

    await execFileAsync('bash', [hookScriptPath], {
      env: fallbackEnv(),
      timeout: 10_000,
    })

    expect(readFileSync(heartbeatLog, 'utf-8')).toContain('"resolution":"done"')
    expect(readFileSync(bucketFile, 'utf-8').trim().split('\n')).toHaveLength(1)
  })

  it('preserves the existing UNCLEAR fallback for non-timeout claude failures', async () => {
    writeFallbackRuntime()

    await execFileAsync('bash', [hookScriptPath], {
      env: fallbackEnv({ MOCK_CLAUDE_RC: '1' }),
      timeout: 10_000,
    })

    expect(readFileSync(heartbeatLog, 'utf-8')).toContain('"resolution":"unclear"')
    const hooksLog = readFileSync(join(homeDir, '.overdeck', 'logs', 'hooks.log'), 'utf-8')
    expect(hooksLog).toContain('claude -p failed rc=1')
    expect(hooksLog).toContain('fallback to UNCLEAR')
  })
})
