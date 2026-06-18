import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'auto-approve-hook')

function runHook(stdin: string, env: Record<string, string | undefined> = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, PATH: process.env.PATH ?? '', ...env }
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete childEnv[key]
    }

    const child = spawn('bash', [SCRIPT_PATH], {
      env: childEnv,
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
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe('auto-approve-hook', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-auto-approve-hook-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it.each([
    'agent-pan-1616',
    'planning-pan-1616',
    'flywheel-orchestrator',
    'strike-pan-1616',
    'inspect-pan-1616-workspace-kb8b7',
  ])('auto-allows read-only tool calls for %s', async (agentId) => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git diff --stat' } })

    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: agentId })

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string
        permissionDecision?: string
        permissionDecisionReason?: string
      }
    }
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput?.permissionDecision).toBe('allow')
    expect(parsed.hookSpecificOutput?.permissionDecisionReason).toContain('Overdeck autonomous pipeline agent auto-approve')
  })

  it.each([
    ['conversation agents', 'conv-pan-1616'],
    ['unset agent ID', undefined],
  ] as const)('stays silent for %s', async (_label, agentId) => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git diff --stat' } })

    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: agentId })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('does not auto-allow AskUserQuestion even for in-scope pipeline agents', async () => {
    const stdin = JSON.stringify({
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{ question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
      },
    })

    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: 'inspect-pan-1616-workspace-kb8b7' })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})
