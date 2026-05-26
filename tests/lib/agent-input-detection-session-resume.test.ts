/**
 * PAN-1520 / #1197 — session-resume dialog detection for the unified
 * pending-input subsystem. Long-running agents resumed via `claude --resume`
 * can stall on a dialog that asks the operator to confirm continuation. We
 * detect that pattern in the tmux pane and emit a `session_resume` reason
 * so the kanban INPUT indicator fires and a desktop notification triggers.
 */
import { describe, it, expect } from 'vitest'
import { detectAwaitingInputFromPaneSync } from '../../src/lib/agent-input-detection.js'

describe('detectAwaitingInputFromPaneSync — session_resume', () => {
  it('detects "this session is still active" wording', () => {
    const pane = [
      'Starting Claude...',
      'Loaded session abc123',
      'This session is still active in another window.',
      '> Continue here',
      '  Cancel',
    ].join('\n')
    const result = detectAwaitingInputFromPaneSync(pane)
    expect(result?.reason).toBe('session_resume')
  })

  it('detects "resume the previous session" wording', () => {
    const pane = [
      'claude --resume',
      'Do you want to resume the previous session?',
      '[Y/n]',
    ].join('\n')
    const result = detectAwaitingInputFromPaneSync(pane)
    expect(result?.reason).toBe('session_resume')
  })

  it('detects "press enter to continue" resume prompt', () => {
    const pane = [
      'Welcome back',
      'Press Enter to continue your session',
    ].join('\n')
    const result = detectAwaitingInputFromPaneSync(pane)
    expect(result?.reason).toBe('session_resume')
  })

  it('does NOT false-positive on the word "resume" alone', () => {
    const pane = [
      'Adding resume function to handler...',
      'Editing src/lib/handler.ts',
    ].join('\n')
    const result = detectAwaitingInputFromPaneSync(pane)
    expect(result).toBeNull()
  })

  it('prioritises explicit permission menus over the session-resume heuristic', () => {
    const pane = [
      'this session is still active', // would trigger session_resume on its own
      '',
      'Do you want to allow this tool call?',
      '❯ 1. Yes',
      '  2. Yes, and don\'t ask',
      '  3. No',
    ].join('\n')
    const result = detectAwaitingInputFromPaneSync(pane)
    // The permission menu check runs first and is the more specific signal.
    expect(result?.reason).toBe('tool_permission')
  })
})
