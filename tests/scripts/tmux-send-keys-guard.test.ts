import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT_PATH = join(process.cwd(), 'sync-sources', 'hooks', 'tmux-send-keys-guard')

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

describe('tmux-send-keys-guard', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pan-tmux-guard-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('passes through non-Bash tools silently', async () => {
    const stdin = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/etc/passwd' } })
    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: 'agent-pan-1084' })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('passes through Bash commands that do not touch tmux', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git diff --stat' } })
    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: 'agent-pan-1084' })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('passes through tmux send-keys without an explicit target', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tmux send-keys C-c' } })
    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: 'agent-pan-1084' })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('passes through tmux send-keys targeted at the work agent itself', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tmux -L overdeck send-keys -t agent-pan-1084 C-c' } })
    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: 'agent-pan-1084' })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('passes through tmux send-keys targeted at a pane within the work agent session', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tmux send-keys -t agent-pan-1084:0.0 C-c' } })
    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: 'agent-pan-1084' })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })

  it('blocks tmux send-keys targeted at another agent session', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tmux -L overdeck send-keys -t inspect-pan-1059-workspace-hiq5 2 C-m' } })
    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: 'agent-pan-1084' })

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string
        updatedInput?: { command?: string }
      }
    }
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput?.updatedInput?.command).toContain('false')
    expect(parsed.hookSpecificOutput?.updatedInput?.command).toContain('inspect-pan-1059-workspace-hiq5')
    expect(parsed.hookSpecificOutput?.updatedInput?.command).toContain('BLOCKED')
  })

  it('blocks tmux paste-buffer targeted at another agent session', async () => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tmux paste-buffer -t inspect-pan-1059-workspace-hiq5' } })
    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: 'agent-pan-1084' })

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as {
      hookSpecificOutput?: {
        hookEventName?: string
        updatedInput?: { command?: string }
      }
    }
    expect(parsed.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
    expect(parsed.hookSpecificOutput?.updatedInput?.command).toContain('false')
    expect(parsed.hookSpecificOutput?.updatedInput?.command).toContain('inspect-pan-1059-workspace-hiq5')
  })

  it.each([
    ['planning agent', 'planning-pan-1084'],
    ['plan agent with suffix', 'agent-pan-1084-plan'],
    ['test agent', 'agent-pan-1084-test'],
    ['inspect agent', 'inspect-pan-1084-workspace-abc12'],
    ['flywheel orchestrator', 'flywheel-orchestrator'],
    ['conversation session', 'conv-20260627-1234'],
    ['unset agent ID', undefined],
  ] as const)('stays silent for %s', async (_label, agentId) => {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'tmux -L overdeck send-keys -t inspect-pan-1059-workspace-hiq5 2 C-m' } })
    const { stdout, code } = await runHook(stdin, { HOME: home, OVERDECK_AGENT_ID: agentId })

    expect(code).toBe(0)
    expect(stdout.trim()).toBe('')
  })
})
