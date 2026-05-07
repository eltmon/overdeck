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
  let runtimeJson: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pan986-stop-hook-'))
    homeDir = join(tempRoot, 'home')
    mockBin = join(tempRoot, 'bin')
    heartbeatLog = join(tempRoot, 'heartbeat.log')
    tmuxLog = join(tempRoot, 'tmux.log')
    claudeLog = join(tempRoot, 'claude.log')
    runtimeJson = join(tempRoot, 'runtime.json')

    mkdirSync(homeDir, { recursive: true })
    mkdirSync(mockBin, { recursive: true })
    mkdirSync(join(homeDir, '.panopticon', 'agents', AGENT_ID), { recursive: true })

    writeExecutable(
      join(mockBin, 'curl'),
      `#!/bin/bash
set -euo pipefail
args="$*"
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

    await execFileAsync('bash', [SCRIPT_PATH], {
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
})
