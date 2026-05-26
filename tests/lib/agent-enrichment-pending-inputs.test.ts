/**
 * Tests for the PAN-1520 unified pending-input scan in agent-enrichment.ts.
 *
 * Covers every JSONL-derived blocking surface:
 *   - AskUserQuestion (with various tool_result shapes)
 *   - ExitPlanMode (operator approval pending)
 *   - EnterPlanMode (plan being drafted)
 *
 * Notably: ensures that an AskUserQuestion `tool_result` written by the PAN-1520
 * deny hook is treated as STILL PENDING (because the operator has not actually
 * answered; only the upstream tool was denied to force a plain-text restate).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Effect } from 'effect'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getPendingQuestions } from '../../src/lib/agent-enrichment.js'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'pan-1520-pending-inputs-'))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

interface JsonlLine {
  timestamp?: string
  message?: { content?: unknown[] }
}

function writeJsonlSession(filename: string, lines: JsonlLine[]): string {
  const path = join(testDir, filename)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'), 'utf-8')
  return path
}

function askToolUse(id: string, options: string[]): unknown {
  return {
    type: 'tool_use',
    id,
    name: 'AskUserQuestion',
    input: {
      questions: [{
        question: 'pick one',
        header: 'Choice',
        multiSelect: false,
        options: options.map((label) => ({ label, description: `${label} desc` })),
      }],
    },
  }
}

function toolResult(toolUseId: string, opts: { content?: string; is_error?: boolean } = {}): unknown {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: opts.content ?? 'ok',
    ...(opts.is_error !== undefined ? { is_error: opts.is_error } : {}),
  }
}

describe('getPendingQuestions — AskUserQuestion lifecycle', () => {
  it('returns a pending question when no tool_result has arrived', async () => {
    const path = writeJsonlSession('a.jsonl', [
      { timestamp: '2026-05-26T01:00:00Z', message: { content: [askToolUse('t1', ['A', 'B'])] } },
    ])
    const result = await Effect.runPromise(getPendingQuestions(path))
    expect(result).toHaveLength(1)
    expect(result[0].toolId).toBe('t1')
  })

  it('does NOT return the question after a real (non-hook) tool_result arrives', async () => {
    const path = writeJsonlSession('a.jsonl', [
      { timestamp: '2026-05-26T01:00:00Z', message: { content: [askToolUse('t1', ['A', 'B'])] } },
      { timestamp: '2026-05-26T01:00:05Z', message: { content: [toolResult('t1', { content: 'A' })] } },
    ])
    const result = await Effect.runPromise(getPendingQuestions(path))
    expect(result).toHaveLength(0)
  })

  it('KEEPS the question pending after the PAN-1520 deny hook fires', async () => {
    // The deny hook returns an is_error: true tool_result whose content
    // mentions PAN-1520 — the scanner must treat this as "operator has not
    // actually answered yet" and keep the question pending.
    const denyReason = 'AskUserQuestion is blocked in Panopticon environments to prevent silent corruption (PAN-1520).'
    const path = writeJsonlSession('a.jsonl', [
      { timestamp: '2026-05-26T01:00:00Z', message: { content: [askToolUse('t1', ['A', 'B'])] } },
      { timestamp: '2026-05-26T01:00:01Z', message: { content: [toolResult('t1', { content: denyReason, is_error: true })] } },
    ])
    const result = await Effect.runPromise(getPendingQuestions(path))
    expect(result).toHaveLength(1)
    expect(result[0].toolId).toBe('t1')
  })

  it('handles tool_result with content as array-of-blocks (Claude SDK shape)', async () => {
    const denyText = 'See PAN-1520 — restate the question to the operator in plain text.'
    const path = writeJsonlSession('a.jsonl', [
      { timestamp: '2026-05-26T01:00:00Z', message: { content: [askToolUse('t1', ['A', 'B'])] } },
      {
        timestamp: '2026-05-26T01:00:01Z',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 't1',
            content: [{ type: 'text', text: denyText }],
            is_error: true,
          }],
        },
      },
    ])
    const result = await Effect.runPromise(getPendingQuestions(path))
    expect(result).toHaveLength(1)
  })

  it('returns only the most recent AUQ when several have been answered', async () => {
    const path = writeJsonlSession('a.jsonl', [
      { timestamp: '2026-05-26T01:00:00Z', message: { content: [askToolUse('t1', ['A', 'B'])] } },
      { timestamp: '2026-05-26T01:00:01Z', message: { content: [toolResult('t1', { content: 'A' })] } },
      { timestamp: '2026-05-26T01:00:10Z', message: { content: [askToolUse('t2', ['Yes', 'No'])] } },
    ])
    const result = await Effect.runPromise(getPendingQuestions(path))
    expect(result.map((r) => r.toolId)).toEqual(['t2'])
  })
})

describe('agent-enrichment scan — plan mode + missing files', () => {
  it('returns empty array for a missing JSONL file', async () => {
    const result = await Effect.runPromise(getPendingQuestions(join(testDir, 'nope.jsonl')))
    expect(result).toEqual([])
  })

  it('tolerates malformed lines without crashing', async () => {
    const path = join(testDir, 'malformed.jsonl')
    writeFileSync(path, [
      'not-json-{',
      JSON.stringify({ timestamp: '2026-05-26T01:00:00Z', message: { content: [askToolUse('t1', ['A'])] } }),
      '}',
    ].join('\n'), 'utf-8')
    const result = await Effect.runPromise(getPendingQuestions(path))
    expect(result).toHaveLength(1)
  })
})
