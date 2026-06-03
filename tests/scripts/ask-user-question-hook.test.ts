import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'ask-user-question-hook')

function writeStubHookLib(dir: string, eventLog: string): void {
  const lib = `#!/bin/bash
set +e
pan_resolve_agent_id() {
  AGENT_ID="\${PANOPTICON_AGENT_ID:-}"
  [ -n "$AGENT_ID" ]
}
pan_emit_event() {
  echo "$1|$2" >> "${eventLog}"
}
`
  writeFileSync(join(dir, 'pan-hook-lib.sh'), lib, 'utf-8')
  chmodSync(join(dir, 'pan-hook-lib.sh'), 0o755)
}

function runHook(scriptDir: string, stdin: string, env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(join(scriptDir, 'ask-user-question-hook'), [], {
      env: { ...process.env, ...env, PATH: process.env.PATH ?? '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 })
    })
    child.on('error', () => {
      resolve({ stdout, stderr, code: 1 })
    })
    if (stdin) child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe('ask-user-question-hook (PAN-1520)', () => {
  let tempDir: string
  let eventLog: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-auq-hook-'))
    eventLog = join(tempDir, 'events.log')
    mkdirSync(tempDir, { recursive: true })

    writeFileSync(join(tempDir, 'ask-user-question-hook'), readFileSync(SCRIPT_PATH, 'utf-8'), 'utf-8')
    chmodSync(join(tempDir, 'ask-user-question-hook'), 0o755)
    writeStubHookLib(tempDir, eventLog)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('denies AskUserQuestion calls with a deny verdict and the full question payload as additionalContext', async () => {
    const stdin = JSON.stringify({
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          {
            question: 'How do we stop the spam?',
            header: 'Spam cleanup',
            multiSelect: false,
            options: [
              { label: 'pan close 1203 (proper close-out)', description: 'Run close-out ceremony.' },
              { label: 'Flip autoAdvance: false', description: 'Disable flywheel autoAdvance.' },
            ],
          },
        ],
      },
    })

    const { stdout, code } = await runHook(tempDir, stdin, { PANOPTICON_AGENT_ID: 'agent-pan-1520' })

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string
        permissionDecision?: string
        permissionDecisionReason?: string
        additionalContext?: string
      }
    }
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(parsed.hookSpecificOutput?.permissionDecisionReason).toMatch(/surfaced to the operator/i)
    expect(parsed.hookSpecificOutput?.additionalContext).toContain('How do we stop the spam?')
    expect(parsed.hookSpecificOutput?.additionalContext).toContain('pan close 1203 (proper close-out)')
    expect(parsed.hookSpecificOutput?.additionalContext).toContain('Flip autoAdvance: false')
  })

  it('emits a dashboard event when an agent ID is available', async () => {
    const stdin = JSON.stringify({
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{ question: 'Q', options: [{ label: 'A' }, { label: 'B' }] }],
      },
    })

    await runHook(tempDir, stdin, { PANOPTICON_AGENT_ID: 'agent-pan-1520' })

    const events = readFileSync(eventLog, 'utf-8')
    expect(events).toContain('agent-pan-1520')
    expect(events).toContain('ask_user_question_blocked')
  })

  it('passes through silently for non-AskUserQuestion tool calls', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    const { stdout, code } = await runHook(tempDir, stdin, { PANOPTICON_AGENT_ID: 'agent-pan-1520' })
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('exits cleanly on missing stdin', async () => {
    const { stdout, code } = await runHook(tempDir, '', { PANOPTICON_AGENT_ID: 'agent-pan-1520' })
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('exits cleanly on malformed JSON stdin', async () => {
    const { code } = await runHook(tempDir, 'not-json-{', { PANOPTICON_AGENT_ID: 'agent-pan-1520' })
    // Hook must never break Claude Code — exit 0 even on bad input.
    expect(code).toBe(0)
  })
})
