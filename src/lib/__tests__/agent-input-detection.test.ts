import { describe, expect, it } from 'vitest'

import { detectAwaitingInputFromPane } from '../agent-input-detection.js'

describe('detectAwaitingInputFromPane', () => {
  it('detects Claude Code permission menus and preserves prompt text', () => {
    const detection = detectAwaitingInputFromPane(`
● Bash(git status)
  ⎿  Run git status in the workspace

Do you want to proceed?
❯ 1. Yes
  2. Yes, allow all Bash commands in /tmp/project
  3. No
`)

    expect(detection).toMatchObject({ reason: 'tool_permission' })
    expect(detection?.prompt).toContain('Do you want to proceed?')
    expect(detection?.prompt).toContain('2. Yes, allow all Bash commands')
  })

  it('detects generic y/n confirmations near the bottom of the pane', () => {
    const detection = detectAwaitingInputFromPane(`
Preparing migration...
Continue with destructive migration? [y/N]
`)

    expect(detection).toMatchObject({ reason: 'confirmation' })
    expect(detection?.prompt).toContain('Continue with destructive migration? [y/N]')
  })

  it('detects planning finalized sessions waiting for Done only for planning agents', () => {
    const pane = `
Wrote vBRIEF and beads.
Planning finalized — click Done in the dashboard to hand off to the implementation agent.
`

    expect(detectAwaitingInputFromPane(pane, { isPlanning: true })).toMatchObject({ reason: 'planning_done' })
    expect(detectAwaitingInputFromPane(pane, { isPlanning: false })).toBeNull()
  })

  it('ignores old prompts outside the recent pane window', () => {
    const lines = [
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. Yes, allow all Bash commands',
      '  3. No',
      ...Array.from({ length: 30 }, (_, index) => `later output ${index}`),
    ]

    expect(detectAwaitingInputFromPane(lines.join('\n'))).toBeNull()
  })
})
