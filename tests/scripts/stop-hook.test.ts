import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'stop-hook')
const AGENT_ID = 'agent-pan-987-review-requirements'
const SYNTH_AGENT_ID = 'agent-pan-987-review'

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8')
  chmodSync(path, 0o755)
}

describe('stop-hook requirements trace validation (PAN-1498)', () => {
  let tempRoot: string
  let homeDir: string
  let mockBin: string
  let tmuxLog: string
  let tmuxBuffer: string
  let panLog: string
  let hookScriptPath: string
  let outputPath: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'pan987-stop-hook-'))
    homeDir = join(tempRoot, 'home')
    mockBin = join(tempRoot, 'bin')
    tmuxLog = join(tempRoot, 'tmux.log')
    tmuxBuffer = join(tempRoot, 'tmux-buffer.txt')
    panLog = join(tempRoot, 'pan.log')
    hookScriptPath = join(tempRoot, 'stop-hook')
    outputPath = join(homeDir, '.panopticon', 'agents', AGENT_ID, 'review-requirements.md')

    mkdirSync(homeDir, { recursive: true })
    mkdirSync(mockBin, { recursive: true })
    mkdirSync(join(homeDir, '.panopticon', 'agents', AGENT_ID), { recursive: true })
    mkdirSync(join(homeDir, '.panopticon', 'bin'), { recursive: true })
    mkdirSync(join(homeDir, '.panopticon', 'logs'), { recursive: true })

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
  return 0
}
`,
    )

    writeExecutable(join(homeDir, '.panopticon', 'bin', 'specialist-stop-hook'), '#!/bin/bash\nexit 0\n')
    writeExecutable(join(homeDir, '.panopticon', 'bin', 'work-agent-stop-hook'), '#!/bin/bash\nexit 0\n')

    writeExecutable(
      join(mockBin, 'tmux'),
      `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_TMUX_LOG"

# Handle tmux -L panopticon <subcommand> ...
shift_count=0
socket=""
while [ "\$shift_count" -lt 2 ] && [ "\${1:-}" = "-L" ]; do
  socket="\$2"
  shift 2
  shift_count=\$((shift_count + 1))
done

case "\${1:-}" in
  capture-pane) echo "" ;;
  load-buffer)
    cat "\$2" >> "$MOCK_TMUX_BUFFER"
    ;;
  paste-buffer|send-keys) ;;
  *) ;;
esac
exit 0
`,
    )
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  function writeState(): void {
    writeFileSync(
      join(homeDir, '.panopticon', 'agents', AGENT_ID, 'state.json'),
      JSON.stringify({
        id: AGENT_ID,
        issueId: 'PAN-987',
        workspace: '/workspace',
        role: 'review',
        model: 'model',
        status: 'running',
        startedAt: '2026-05-13T00:00:00.000Z',
        reviewSubRole: 'requirements',
        reviewRunId: 'agent-pan-987-review-abcdef12',
        reviewOutputPath: outputPath,
        reviewSynthesisAgentId: SYNTH_AGENT_ID,
      }, null, 2),
      'utf-8',
    )
  }

  function writePanStub(mode: 'pass' | 'fail' | 'unavailable'): void {
    const validateBranch =
      mode === 'pass'
        ? `if [ "\$3" = "--help" ]; then exit 0; fi\n  exit 0`
        : mode === 'fail'
          ? `if [ "\$3" = "--help" ]; then exit 0; fi\n  echo 'requirements review missing live code path trace for ACs: AC-1' >&2\n  exit 1`
          : `if [ "\$3" = "--help" ]; then echo 'unknown command' >&2; exit 1; fi\n  echo 'unknown command' >&2\n  exit 1`

    writeExecutable(
      join(mockBin, 'pan'),
      `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_PAN_LOG"
if [ "\$1" = "tell" ]; then
  exit 0
fi
if [ "\$1" = "review" ] && [ "\$2" = "validate-trace" ]; then
  ${validateBranch}
fi
exit 0
`,
    )
  }

  async function runHook(): Promise<void> {
    await execFileAsync('bash', [hookScriptPath], {
      env: {
        ...process.env,
        HOME: homeDir,
        PATH: `${mockBin}:${process.env.PATH ?? ''}`,
        PANOPTICON_AGENT_ID: AGENT_ID,
        MOCK_TMUX_LOG: tmuxLog,
        MOCK_TMUX_BUFFER: tmuxBuffer,
        MOCK_PAN_LOG: panLog,
      },
      timeout: 10_000,
    })
  }

  it('signals REVIEWER_FAILED when the requirements report fails trace validation', async () => {
    writeState()
    writeFileSync(outputPath, '# invalid report\n', 'utf-8')
    writePanStub('fail')

    await runHook()

    const buffer = readFileSync(tmuxBuffer, 'utf-8').trim()
    expect(buffer).toBe(`REVIEWER_FAILED requirements requirements review missing live code path trace for ACs: AC-1`)
  })

  it('signals REVIEWER_READY when the requirements report passes trace validation', async () => {
    writeState()
    writeFileSync(outputPath, '# valid report\n', 'utf-8')
    writePanStub('pass')

    await runHook()

    const buffer = readFileSync(tmuxBuffer, 'utf-8').trim()
    expect(buffer).toBe(`REVIEWER_READY requirements ${outputPath}`)
  })

  it('falls back to REVIEWER_READY when the trace validator is unavailable', async () => {
    writeState()
    writeFileSync(outputPath, '# invalid report\n', 'utf-8')
    writePanStub('unavailable')

    await runHook()

    const buffer = readFileSync(tmuxBuffer, 'utf-8').trim()
    expect(buffer).toBe(`REVIEWER_READY requirements ${outputPath}`)
    const hooksLog = readFileSync(join(homeDir, '.panopticon', 'logs', 'hooks.log'), 'utf-8')
    expect(hooksLog).toContain('requirements trace validator unavailable')
  })
})
