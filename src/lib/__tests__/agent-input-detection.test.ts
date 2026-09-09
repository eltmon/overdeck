import { describe, expect, it } from 'vitest'

import { detectAwaitingInputFromPaneSync, normalizeAwaitingInputPrompt, parseCodexApprovalPrompt } from '../agent-input-detection.js'

describe('detectAwaitingInputFromPane', () => {
  it('detects Claude Code permission menus and preserves prompt text', () => {
    const detection = detectAwaitingInputFromPaneSync(`
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
    const detection = detectAwaitingInputFromPaneSync(`
Preparing migration...
Continue with destructive migration? [y/N]
`)

    expect(detection).toMatchObject({ reason: 'confirmation' })
    expect(detection?.prompt).toContain('Continue with destructive migration? [y/N]')
  })

  it('detects planning finalized sessions waiting for Done only for planning agents', () => {
    const pane = `
Wrote xBRIEF and tasks.
Planning finalized — click Done in the dashboard to hand off to the implementation agent.
`

    expect(detectAwaitingInputFromPaneSync(pane, { isPlanning: true })).toMatchObject({ reason: 'planning_done' })
    expect(detectAwaitingInputFromPaneSync(pane, { isPlanning: false })).toBeNull()
  })

  it('ignores old prompts outside the recent pane window', () => {
    const lines = [
      'Do you want to proceed?',
      '❯ 1. Yes',
      '  2. Yes, allow all Bash commands',
      '  3. No',
      ...Array.from({ length: 30 }, (_, index) => `later output ${index}`),
    ]

    expect(detectAwaitingInputFromPaneSync(lines.join('\n'))).toBeNull()
  })

  it('clears answered permission prompts once subsequent output appears', () => {
    const detection = detectAwaitingInputFromPaneSync(`
Do you want to proceed?
❯ 1. Yes
  2. Yes, allow all Bash commands
  3. No
● Bash(git status)
  ⎿ On branch feature/test
`)

    expect(detection).toBeNull()
  })

  // PAN-3068 — Claude Code renders a footer hint below "3. No", so requiring the
  // final option to be the literal last pane line meant Claude permission
  // prompts were never detected. Captured verbatim from agent-min-896's pane
  // while it sat frozen on a sensitive-file gate for three hours.
  it('detects a Claude permission menu despite the trailing footer hint', () => {
    const detection = detectAwaitingInputFromPaneSync(`
 Bash command

   rm -r /home/eltmon/Projects/myn/workspaces/feature-min-896/.devcontainer && rm /home/eltmon/Projects/myn/workspaces/feature-min-896/dev && git status --short
   Remove generated harness artifacts and verify cleanliness

 Claude requested permissions to edit /home/eltmon/Projects/myn/workspaces/feature-min-896/.devcontainer which is a sensitive file.

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for similar commands in /home/eltmon/Projects/myn/workspaces/feature-min-896
   3. No

 Esc to cancel · Tab to amend · ctrl+e to explain
`)

    expect(detection).toMatchObject({ reason: 'tool_permission' })
    expect(detection?.prompt).toContain('Do you want to proceed?')
    expect(detection?.prompt).toContain('3. No')
  })

  it('still clears an answered Claude permission menu followed by a footer hint and real output', () => {
    const detection = detectAwaitingInputFromPaneSync(`
Do you want to proceed?
❯ 1. Yes
  2. Yes, allow all Bash commands
  3. No

 Esc to cancel · Tab to amend · ctrl+e to explain
● Bash(git status)
  ⎿ On branch feature/test
`)

    expect(detection).toBeNull()
  })

  // PAN-1690 — Codex TUI approval prompts. Codex renders option descriptions
  // and a footer hint below "3. No", which defeats the Claude trailing-line
  // heuristics; these cases regressed before the codex-aware branch.
  it('detects a Codex command-approval prompt despite a trailing footer hint', () => {
    const detection = detectAwaitingInputFromPaneSync(`
I need local copies of both repos to diff accurately.

  Would you like to run the following command?

  $ git clone https://github.com/eltmon/foo /tmp/foo

  Reason: do you want to allow network access to clone the review target?

❯ 1. Yes, proceed
  2. Yes, and don't ask again for commands that start with \`git clone\`
  3. No, and tell Codex what to do differently

  Press enter to confirm · esc to go back
`)

    expect(detection).toMatchObject({ reason: 'tool_permission' })
    expect(detection?.prompt).toContain('Would you like to run the following command?')
  })

  it('detects a Codex network-host grant prompt with a footer hint', () => {
    const detection = detectAwaitingInputFromPaneSync(`
  Would you like to grant these permissions?

  Network access to github.com

❯ 1. Yes, and allow this host for this conversation
  2. Yes, and allow this host in the future
  3. No, and block this host in the future

  esc to cancel
`)

    expect(detection).toMatchObject({ reason: 'tool_permission' })
  })

  it('does not re-fire a Codex approval header that has scrolled into history', () => {
    const detection = detectAwaitingInputFromPaneSync(`
  Would you like to run the following command?
  $ git clone https://github.com/eltmon/foo /tmp/foo
❯ 1. Yes, proceed
  3. No, and tell Codex what to do differently
${Array.from({ length: 20 }, (_, i) => `cloning… ${i}`).join('\n')}
`)

    expect(detection).toBeNull()
  })

  // PAN-1834 — Codex/gpt-5.5 rate-limit / model-switch modal.
  it('detects a rate-limit model-switch modal near the bottom of the pane', () => {
    const detection = detectAwaitingInputFromPaneSync(`
Rate limit reached for gpt-5.5.

Choose how to continue:
❯ Keep current model
  Switch to gpt-5.4-mini
`)

    expect(detection).toMatchObject({ reason: 'rate_limit' })
    expect(detection?.prompt).toContain('Keep current model')
    expect(detection?.prompt).toContain('Switch to gpt-5.4-mini')
  })

  it('ignores a pane that only mentions a rate limit in prose without the option pairing', () => {
    const detection = detectAwaitingInputFromPaneSync(`
We hit a rate limit for gpt-5.5 and are retrying after a short delay.
Some other progress line here.
`)

    expect(detection).toBeNull()
  })

  it('ignores a rate-limit modal that has scrolled outside the recent window', () => {
    const detection = detectAwaitingInputFromPaneSync(`
Rate limit reached for gpt-5.5.
Choose how to continue:
❯ Keep current model
  Switch to gpt-5.4-mini
${Array.from({ length: 30 }, (_, i) => `later output ${i}`).join('\n')}
`)

    expect(detection).toBeNull()
  })

  // PAN-3766 — ohmypi `ask` modal, keyed on its distinctive footer hint. Shape
  // mirrors a captured live pane: box-drawn frame, bottom border after footer.
  it('detects a pi ask modal as a user_question with the question text in the prompt', () => {
    const detection = detectAwaitingInputFromPaneSync(`
Some earlier agent output.

 ⠙ Choosing which battle to stage live ⟦esc⟧
╭─ Ask ─────────────────────────────────────────────╮
│ Which battle should I stage so it's ready to trigger? │
├───────────────────────────────────────────────────┤
│ ❯ ○ 1 · Camp battle                               │
│   ○ 2 · Strike (offline duel)                     │
│   ○ Other (type your own)                         │
├───────────────────────────────────────────────────┤
│ Enter select · n note · ↑/↓ move · Esc cancel     │
╰───────────────────────────────────────────────────╯
`)

    expect(detection).toMatchObject({ reason: 'user_question' })
    expect(detection?.prompt).toContain('Which battle should I stage')
    expect(detection?.prompt).toContain('Ask')
  })

  it('also detects the unboxed ask layout', () => {
    const detection = detectAwaitingInputFromPaneSync(`
Ask  1 questions
[battle]  options:5
Which battle should I stage?
❯ 1 - Camp battle

Enter select · n note · ↑↓ move · Esc cancel
`)

    expect(detection).toMatchObject({ reason: 'user_question' })
    expect(detection?.prompt).toContain('Which battle should I stage?')
  })

  it('clears the pi ask detection once the modal is answered and output follows', () => {
    const detection = detectAwaitingInputFromPaneSync(`
│ Enter select · n note · ↑/↓ move · Esc cancel     │
╰───────────────────────────────────────────────────╯
The agent continued working after the answer.
`)

    expect(detection).toBeNull()
  })

  it('does not fire on prose that merely mentions the footer keys', () => {
    const detection = detectAwaitingInputFromPaneSync(`
Press Enter to select an item from the list, or Esc to cancel the operation entirely.
Done.
`)

    expect(detection).toBeNull()
  })
})

describe('parseCodexApprovalPrompt', () => {
  it('parses header, detail, and numbered options from a command-approval prompt', () => {
    const parsed = parseCodexApprovalPrompt(`Would you like to run the following command?
$ git clone https://github.com/eltmon/foo /tmp/foo
Reason: do you want to allow network access?
> 1. Yes, proceed
2. Yes, and don't ask again for commands that start with \`git clone\`
3. No, and tell Codex what to do differently
Press enter to confirm · esc to go back`)

    expect(parsed).not.toBeNull()
    expect(parsed?.header).toBe('Would you like to run the following command?')
    expect(parsed?.detail).toContain('git clone')
    expect(parsed?.options).toEqual([
      { number: 1, label: 'Yes, proceed' },
      { number: 2, label: "Yes, and don't ask again for commands that start with `git clone`" },
      { number: 3, label: 'No, and tell Codex what to do differently' },
    ])
  })

  it('returns null when there is no codex approval header', () => {
    expect(parseCodexApprovalPrompt('1. Yes\n2. No\nsome other text')).toBeNull()
  })

  it('returns null when fewer than two options are present', () => {
    expect(parseCodexApprovalPrompt('Would you like to run the following command?\n1. Yes')).toBeNull()
  })
})

describe('normalizeAwaitingInputPrompt', () => {
  it('truncates oversized prompt text from non-pane sources', () => {
    const normalized = normalizeAwaitingInputPrompt('x'.repeat(2_500))

    expect(normalized.length).toBe(2_000)
    expect(normalized.endsWith('…')).toBe(true)
  })
})
