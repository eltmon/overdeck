import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The hook is installed extensionless and run as `node codex-notify-hook`. It
// must be executed from a directory WITHOUT a `type: module` package.json
// ancestor so Node's extensionless-entry ESM default applies exactly as it does
// in ~/.overdeck/bin/. Copying it under tmpdir gives us that.
const SOURCE_HOOK = join(process.cwd(), 'sync-sources', 'hooks', 'codex-notify-hook')
const AGENT_ID = 'agent-pan-2675-review-security'
const SYNTH_ID = 'agent-pan-2675-review'

describe('codex-notify-hook REVIEWER_READY signal (PAN-2675)', () => {
  let tempRoot: string
  let overdeckHome: string
  let mockBin: string
  let hookPath: string
  let tmuxLog: string
  let reportPath: string
  let agentDir: string

  function writeTmuxMock(pasteExit: number): void {
    writeFileSync(
      join(mockBin, 'tmux'),
      `#!/bin/bash\nprintf '%s\\n' "$*" >> "$MOCK_TMUX_LOG"\ncase "$*" in *paste-buffer*) exit ${pasteExit};; esac\nexit 0\n`,
      'utf-8',
    )
    chmodSync(join(mockBin, 'tmux'), 0o755)
  }

  function writeState(): void {
    writeFileSync(
      join(agentDir, 'state.json'),
      JSON.stringify({
        reviewOutputPath: reportPath,
        reviewSubRole: 'security',
        reviewSynthesisAgentId: SYNTH_ID,
      }),
      'utf-8',
    )
  }

  function runHook(): void {
    spawnSync('node', [hookPath], {
      input: '{}',
      env: {
        ...process.env,
        OVERDECK_HOME: overdeckHome,
        OVERDECK_AGENT_ID: AGENT_ID,
        MOCK_TMUX_LOG: tmuxLog,
        PATH: `${mockBin}:${process.env.PATH ?? ''}`,
      },
      timeout: 10_000,
    })
  }

  const markerPath = () => join(agentDir, 'reviewer-signaled')
  const hooksLog = () => join(overdeckHome, 'logs', 'hooks.log')

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'codex-notify-hook-'))
    overdeckHome = join(tempRoot, 'home')
    mockBin = join(tempRoot, 'bin')
    hookPath = join(tempRoot, 'codex-notify-hook')
    tmuxLog = join(tempRoot, 'tmux.log')
    reportPath = join(tempRoot, 'report.md')
    agentDir = join(overdeckHome, 'agents', AGENT_ID)

    mkdirSync(mockBin, { recursive: true })
    mkdirSync(agentDir, { recursive: true })
    copyFileSync(SOURCE_HOOK, hookPath)
    chmodSync(hookPath, 0o755)
    writeTmuxMock(0)
    writeState()
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('delivers REVIEWER_READY and writes the marker when the report is non-empty', () => {
    writeFileSync(reportPath, 'security findings\n', 'utf-8')

    runHook()

    const tmux = readFileSync(tmuxLog, 'utf-8')
    expect(tmux).toContain('load-buffer')
    expect(tmux).toContain(`paste-buffer -t ${SYNTH_ID}`)
    expect(tmux).toContain(`send-keys -t ${SYNTH_ID} C-m`)
    expect(existsSync(markerPath())).toBe(true)
    expect(readFileSync(hooksLog(), 'utf-8')).toContain(
      `signaled REVIEWER_READY security to ${SYNTH_ID}`,
    )
    // Base heartbeat behavior still runs (the ESM conversion did not break it).
    expect(existsSync(join(overdeckHome, 'heartbeats', `${AGENT_ID}.json`))).toBe(true)
  })

  it('delivers the exact "REVIEWER_READY <subRole> <outputPath>" payload via the buffer', () => {
    writeFileSync(reportPath, 'security findings\n', 'utf-8')

    // Capture what load-buffer received by having the mock echo the buffer file.
    writeFileSync(
      join(mockBin, 'tmux'),
      `#!/bin/bash\nprintf '%s\\n' "$*" >> "$MOCK_TMUX_LOG"\n` +
        `if [ "$3" = "load-buffer" ]; then cat "$4" >> "$MOCK_TMUX_LOG"; printf '\\n' >> "$MOCK_TMUX_LOG"; fi\nexit 0\n`,
      'utf-8',
    )
    chmodSync(join(mockBin, 'tmux'), 0o755)

    runHook()

    expect(readFileSync(tmuxLog, 'utf-8')).toContain(`REVIEWER_READY security ${reportPath}`)
  })

  it('leaves an empty report alone — no delivery, no marker (Deacon timeout is the failure path)', () => {
    writeFileSync(reportPath, '', 'utf-8')

    runHook()

    expect(existsSync(tmuxLog)).toBe(false)
    expect(existsSync(markerPath())).toBe(false)
    expect(existsSync(hooksLog())).toBe(false)
    // Hook still completes its base work.
    expect(existsSync(join(overdeckHome, 'heartbeats', `${AGENT_ID}.json`))).toBe(true)
  })

  it('does not re-signal when the reviewer-signaled marker already exists', () => {
    writeFileSync(reportPath, 'security findings\n', 'utf-8')
    writeFileSync(markerPath(), '', 'utf-8')

    runHook()

    expect(existsSync(tmuxLog)).toBe(false)
    expect(existsSync(hooksLog())).toBe(false)
  })

  it('does NOT write the marker when tmux delivery fails, so a later turn can retry', () => {
    writeFileSync(reportPath, 'security findings\n', 'utf-8')
    writeTmuxMock(1) // paste-buffer exits non-zero → delivery failed

    runHook()

    expect(readFileSync(tmuxLog, 'utf-8')).toContain('paste-buffer')
    expect(existsSync(markerPath())).toBe(false)
    expect(existsSync(hooksLog())).toBe(false)
  })

  it('ignores non-reviewer codex agents (no state fields, no tmux)', () => {
    writeFileSync(reportPath, 'security findings\n', 'utf-8')

    spawnSync('node', [hookPath], {
      input: '{}',
      env: {
        ...process.env,
        OVERDECK_HOME: overdeckHome,
        OVERDECK_AGENT_ID: 'agent-pan-2675', // work agent, not a review sub-role
        MOCK_TMUX_LOG: tmuxLog,
        PATH: `${mockBin}:${process.env.PATH ?? ''}`,
      },
      timeout: 10_000,
    })

    expect(existsSync(tmuxLog)).toBe(false)
  })
})
