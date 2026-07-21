/**
 * Contract test for the PAN-1520 AskUserQuestion deny hook and its detector.
 *
 * Spawns the real hook script with a synthetic PreToolUse payload, asserts the
 * hook emits a deny verdict, and verifies that the agent-enrichment detector
 * treats that verdict as a still-pending question.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { getPendingQuestions } from '../../src/lib/agent-enrichment.js'

const hookPath = join(fileURLToPath(import.meta.url), '..', '..', '..', 'sync-sources/hooks/ask-user-question-hook')

interface HookOutput {
  hookSpecificOutput?: {
    hookEventName?: string
    permissionDecision?: string
    permissionDecisionReason?: string
    additionalContext?: string
  }
}

async function runHook(): Promise<HookOutput> {
  const payload = JSON.stringify({
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [
        {
          question: 'Choose a strategy',
          header: 'Strategy',
          multiSelect: false,
          options: [
            { label: 'A', description: 'Fast path' },
            { label: 'B', description: 'Safe path' },
          ],
        },
      ],
    },
  })

  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [hookPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdin.write(payload)
    proc.stdin.end()
    proc.stdout.on('data', (chunk) => { stdout += chunk })
    proc.stderr.on('data', (chunk) => { stderr += chunk })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`hook exited ${code}: ${stderr || stdout}`))
        return
      }
      try {
        resolve(JSON.parse(stdout) as HookOutput)
      } catch (err) {
        reject(new Error(`failed to parse hook stdout: ${stdout}`))
      }
    })
  })
}

function writeJsonlSession(dir: string, lines: unknown[]): string {
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf-8')
  return path
}

function askToolUse(id: string): unknown {
  return {
    type: 'tool_use',
    id,
    name: 'AskUserQuestion',
    input: {
      questions: [{
        question: 'pick one',
        header: 'Choice',
        multiSelect: false,
        options: [
          { label: 'A', description: 'A desc' },
          { label: 'B', description: 'B desc' },
        ],
      }],
    },
  }
}

function toolResult(toolUseId: string, content: string, is_error = false): unknown {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content,
    is_error,
  }
}

describe('AUQ deny hook → detector contract', () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'auq-contract-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('hook emits a deny verdict with a reason containing PAN-1520', async () => {
    const output = await runHook()
    expect(output.hookSpecificOutput?.hookEventName).toBe('PreToolUse')
    expect(output.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain('(PAN-1520)')
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain('surfaced to the operator')
  })

  it('detector keeps the question pending when given the hook reason', async () => {
    const output = await runHook()
    const reason = output.hookSpecificOutput?.permissionDecisionReason
    expect(reason).toBeTruthy()

    const path = writeJsonlSession(testDir, [
      { timestamp: '2026-05-26T01:00:00Z', message: { content: [askToolUse('t1')] } },
      { timestamp: '2026-05-26T01:00:01Z', message: { content: [toolResult('t1', reason!, true)] } },
    ])

    const result = await Effect.runPromise(getPendingQuestions(path))
    expect(result).toHaveLength(1)
    expect(result[0].toolId).toBe('t1')
  })
})
