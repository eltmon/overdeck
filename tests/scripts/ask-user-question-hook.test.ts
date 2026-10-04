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
    // A hook that exits before reading stdin makes this write EPIPE; the exit code is the answer.
    child.stdin.on('error', () => {})
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

    const { stdout, code } = await runHook(tempDir, stdin, { OVERDECK_AGENT_ID: 'agent-pan-1520' })

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
        questions: [
          {
            question: 'Choose a strategy',
            header: 'Strategy',
            options: [
              { label: 'Fast path', description: 'Skip the deep scan.' },
              { label: 'Safe path', description: 'Run the full verification first.' },
            ],
          },
        ],
      },
    })

    await runHook(tempDir, stdin, { OVERDECK_AGENT_ID: 'agent-pan-1520' })

    const events = readFileSync(eventLog, 'utf-8')
    expect(events).toContain('agent-pan-1520')
    expect(events).toContain('ask_user_question_blocked')
  })

  it('passes through silently for non-AskUserQuestion tool calls', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })
    const { stdout, code } = await runHook(tempDir, stdin, { OVERDECK_AGENT_ID: 'agent-pan-1520' })
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('exits cleanly on missing stdin', async () => {
    const { stdout, code } = await runHook(tempDir, '', { OVERDECK_AGENT_ID: 'agent-pan-1520' })
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('exits cleanly on malformed JSON stdin', async () => {
    const { code } = await runHook(tempDir, 'not-json-{', { OVERDECK_AGENT_ID: 'agent-pan-1520' })
    // Hook must never break Claude Code — exit 0 even on bad input.
    expect(code).toBe(0)
  })

  describe('PAN-4514 guard: non-decision calls rejected before surfacing', () => {
    async function expectGuardDeny(tool_input: unknown, env: Record<string, string> = {}): Promise<string> {
      const stdin = JSON.stringify({ tool_name: 'AskUserQuestion', tool_input })
      const { stdout, code } = await runHook(tempDir, stdin, { OVERDECK_AGENT_ID: 'agent-pan-1520', ...env })
      expect(code).toBe(0)
      const parsed = JSON.parse(stdout) as {
        hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
      }
      expect(parsed.hookSpecificOutput?.permissionDecision).toBe('deny')
      const reason = parsed.hookSpecificOutput?.permissionDecisionReason ?? ''
      expect(reason).toContain('AskUserQuestion is for decisions only')
      expect(reason).toContain('end your turn')
      expect(reason).not.toMatch(/PAN-1520|surfaced to the operator/)
      return reason
    }

    it.each([
      ['empty questions array', { questions: [] }],
      [
        'placeholder header/question with bare a/b options',
        { questions: [{ question: 'placeholder', header: 'x', options: [{ label: 'a' }, { label: 'b' }] }] },
      ],
      [
        'status-check-only text with a second option',
        {
          questions: [
            {
              question:
                "Status check only (no action needed): I'm mid-task running a background lint check. This is informational, not a decision point.",
              header: 'Status',
              options: [{ label: 'Acknowledge' }, { label: 'Continue' }],
            },
          ],
        },
      ],
    ])('incident payload: %s', async (_name, tool_input) => {
      const reason = await expectGuardDeny(tool_input)
      expect(reason.length).toBeGreaterThan(0)
    })

    it('rejects single-letter options with no descriptions', async () => {
      const reason = await expectGuardDeny({
        questions: [{ question: 'Pick one', header: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }],
      })
      expect(reason).toContain('single-letter options with no descriptions')
    })

    it('rejects duplicate option labels', async () => {
      const reason = await expectGuardDeny({
        questions: [
          {
            question: 'Which path should we take',
            header: 'Path',
            options: [
              { label: 'Option A', description: 'First' },
              { label: 'option a', description: 'Second' },
            ],
          },
        ],
      })
      expect(reason).toContain('duplicate option labels')
    })

    it('rejects "no action needed" status text', async () => {
      const reason = await expectGuardDeny({
        questions: [
          {
            question: 'No action needed, just an update on progress so far',
            header: 'Update',
            options: [{ label: 'Acknowledge' }, { label: 'Continue' }],
          },
        ],
      })
      expect(reason).toContain('status-only text, not a decision')
    })

    it('does not write an ask_user_question_blocked event for a guard-denied call', async () => {
      await expectGuardDeny({ questions: [] })
      expect(() => readFileSync(eventLog, 'utf-8')).toThrow()
    })

    it('still surfaces a real question with A/B labels that have descriptions', async () => {
      const stdin = JSON.stringify({
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            {
              question: 'Which rollout strategy should we use?',
              header: 'Rollout',
              options: [
                { label: 'A', description: 'Fast path: skip the deep scan.' },
                { label: 'B', description: 'Safe path: run full verification first.' },
              ],
            },
          ],
        },
      })
      const { stdout, code } = await runHook(tempDir, stdin, { OVERDECK_AGENT_ID: 'agent-pan-1520' })
      expect(code).toBe(0)
      const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecisionReason?: string } }
      expect(parsed.hookSpecificOutput?.permissionDecisionReason).toMatch(/surfaced to the operator/i)
    })

    it('still surfaces a real question containing the word "informational"', async () => {
      const stdin = JSON.stringify({
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            {
              question: 'Should the default log level be informational or debug?',
              header: 'Log level',
              options: [
                { label: 'Informational', description: 'Lower verbosity.' },
                { label: 'Debug', description: 'Higher verbosity.' },
              ],
            },
          ],
        },
      })
      const { stdout, code } = await runHook(tempDir, stdin, { OVERDECK_AGENT_ID: 'agent-pan-1520' })
      expect(code).toBe(0)
      const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecisionReason?: string } }
      expect(parsed.hookSpecificOutput?.permissionDecisionReason).toMatch(/surfaced to the operator/i)
    })
  })
})
