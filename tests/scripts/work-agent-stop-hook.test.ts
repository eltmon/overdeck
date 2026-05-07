import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SCRIPT_PATH = join(process.cwd(), 'scripts', 'work-agent-stop-hook')
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
    hookScriptPath = join(tempRoot, 'work-agent-stop-hook')

    mkdirSync(homeDir, { recursive: true })
    mkdirSync(mockBin, { recursive: true })
    mkdirSync(join(homeDir, '.panopticon', 'agents', AGENT_ID), { recursive: true })

    writeFileSync(hookScriptPath, readFileSync(SCRIPT_PATH, 'utf-8'), 'utf-8')
    chmodSync(hookScriptPath, 0o755)
    writeExecutable(
      join(tempRoot, 'pan-hook-lib.sh'),
      `#!/bin/bash
set +e
PAN_DASHBOARD_URL="\${PANOPTICON_DASHBOARD_URL:-http://127.0.0.1:3000}"
pan_resolve_agent_id() {
  AGENT_ID="\${PANOPTICON_AGENT_ID:-}"
  [ -n "$AGENT_ID" ]
}
pan_emit_event() {
  local agent_id="$1"
  local body="$2"
  curl -s -m 0.5 -X POST "$PAN_DASHBOARD_URL/api/agents/$agent_id/heartbeat" --data "$body" >/dev/null 2>&1
}
`,
    )

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
exit 99
`,
    )
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

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
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${mockBin}:${process.env.PATH ?? ''}`,
        PANOPTICON_AGENT_ID: AGENT_ID,
        PANOPTICON_DASHBOARD_URL: 'http://mocked-dashboard.local',
        MOCK_RUNTIME_JSON: runtimeJson,
        MOCK_HEARTBEAT_LOG: heartbeatLog,
        MOCK_TMUX_LOG: tmuxLog,
        MOCK_CLAUDE_LOG: claudeLog,
        MOCK_CURL_LOG: curlLog,
      },
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

    const hooksLog = readFileSync(join(homeDir, '.panopticon', 'logs', 'hooks.log'), 'utf-8')
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
})
