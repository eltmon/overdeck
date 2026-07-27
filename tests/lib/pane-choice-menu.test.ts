/**
 * PAN-3113 — pane choice-menu parser. Fixtures model the real Claude Code
 * session-resume gate captured from an operator's pane (2026-07-26), plus the
 * false-positive shapes seen in live captures: numbered prose lines, plan
 * outlines, permission menus, and answered menus with output below.
 */
import { describe, it, expect } from 'vitest'
import {
  parsePaneChoiceMenu,
  paneChoiceMenuSignature,
  buildChoiceKeystrokes,
  paneHasBlockingChoiceMenu,
} from '../../src/lib/pane-choice-menu.js'

/** Verbatim resume-gate menu as rendered in the operator's pane. */
const RESUME_GATE_MENU = [
  'This session is 4h 5m old and 146.9k tokens.',
  '',
  'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.',
  '',
  '❯ 1. Resume from summary (recommended)',
  '  2. Resume full session as-is',
  "  3. Don't ask me again",
  '',
  'Enter to confirm · Esc to cancel',
].join('\n')

describe('parsePaneChoiceMenu — resume gate (real capture)', () => {
  it('parses title, context, options, cursor and footer at high confidence', () => {
    const menu = parsePaneChoiceMenu(RESUME_GATE_MENU)
    expect(menu).not.toBeNull()
    expect(menu!.confidence).toBe('high')
    expect(menu!.title).toBe('This session is 4h 5m old and 146.9k tokens.')
    expect(menu!.contextLines[0]).toBe('This session is 4h 5m old and 146.9k tokens.')
    expect(menu!.options.map((o) => o.label)).toEqual([
      'Resume from summary',
      'Resume full session as-is',
      "Don't ask me again",
    ])
    expect(menu!.options[0]!.recommended).toBe(true)
    expect(menu!.options[1]!.recommended).toBe(false)
    expect(menu!.selectedIndex).toBe(0)
    expect(menu!.footerHint).toBe('Enter to confirm · Esc to cancel')
  })

  it('parses the menu when conversation prose (incl. a numbered prose line) sits above it', () => {
    const pane = [
      '3. FCM push is dead at the credential layer — MIN-906 (High). Google is returning 401 to the backend\'s',
      '   Firebase service account itself, which means no push delivery at all.',
      '',
      'Bottom line: the outage is over and will recur on every deploy until MIN-904 lands.',
      '',
      '✻ Sautéed for 8m 26s',
      '',
      RESUME_GATE_MENU,
    ].join('\n')
    const menu = parsePaneChoiceMenu(pane)
    expect(menu).not.toBeNull()
    expect(menu!.options).toHaveLength(3)
    expect(menu!.title).toBe('This session is 4h 5m old and 146.9k tokens.')
  })

  it('parses when tmux pads the pane with blank filler to full height', () => {
    // A 30-row pane: the menu occupies the top 9 lines, 21 blanks follow.
    const pane = RESUME_GATE_MENU + '\n' + Array.from({ length: 21 }, () => '').join('\n')
    const menu = parsePaneChoiceMenu(pane)
    expect(menu).not.toBeNull()
    expect(menu!.confidence).toBe('high')
    expect(menu!.options).toHaveLength(3)
  })

  it('strips ANSI escapes before parsing', () => {
    const ansi = RESUME_GATE_MENU.replace('❯ 1. Resume', '\x1b[32m❯\x1b[0m 1. Resume')
      .replace('This session is', '\x1b[1mThis session is\x1b[0m')
    const menu = parsePaneChoiceMenu(ansi)
    expect(menu).not.toBeNull()
    expect(menu!.options[0]!.label).toBe('Resume from summary')
  })
})

describe('parsePaneChoiceMenu — cursor variants', () => {
  it('reports selectedIndex from the cursor row', () => {
    const pane = RESUME_GATE_MENU
      .replace('❯ 1. Resume from summary', '  1. Resume from summary')
      .replace('  2. Resume full session as-is', '❯ 2. Resume full session as-is')
    const menu = parsePaneChoiceMenu(pane)
    expect(menu).not.toBeNull()
    expect(menu!.selectedIndex).toBe(1)
  })

  it('drops to low confidence when the footer hint is absent', () => {
    const pane = RESUME_GATE_MENU.replace('\n\nEnter to confirm · Esc to cancel', '')
    const menu = parsePaneChoiceMenu(pane)
    expect(menu).not.toBeNull()
    expect(menu!.confidence).toBe('low')
  })

  it('drops to low confidence when the cursor row is absent (scrolled highlight)', () => {
    const pane = RESUME_GATE_MENU.replace('❯ 1.', '  1.')
    const menu = parsePaneChoiceMenu(pane)
    expect(menu).not.toBeNull()
    expect(menu!.confidence).toBe('low')
    expect(menu!.selectedIndex).toBe(0)
  })

  it('returns null with neither cursor nor footer — a bare numbered list', () => {
    const pane = ['  1. Alpha', '  2. Beta', '  3. Gamma'].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
  })
})

describe('parsePaneChoiceMenu — rejections', () => {
  it('rejects Claude permission menus (owned by the tool_permission path)', () => {
    const pane = [
      'Do you want to allow this Bash command?',
      '',
      '❯ 1. Yes',
      "  2. Yes, and don't ask again",
      '  3. No',
      '',
      'Esc to cancel · Tab to amend',
    ].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
  })

  it('rejects multi-select menus (space-to-select)', () => {
    const pane = [
      'Pick the items to include:',
      '',
      '❯ 1. First',
      '  2. Second',
      '',
      'Space to select · Enter to confirm',
    ].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
  })

  it('rejects a prose numbered list with trailing prose after it', () => {
    const pane = [
      'The plan is:',
      '1. Fix the parser',
      '2. Add tests',
      '3. Ship it',
      'Let me know which step to start with.',
    ].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
  })

  it('rejects when real output follows the menu (answered and scrolled)', () => {
    const pane = [
      RESUME_GATE_MENU,
      '',
      'Resuming from summary…',
      '✻ Worked for 12s',
    ].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
  })

  it('rejects when a bare input prompt follows the menu', () => {
    const pane = [RESUME_GATE_MENU, '', '❯ '].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
  })

  it('rejects non-sequential numbering', () => {
    const pane = [
      '❯ 2. Second thing',
      '  3. Third thing',
      '',
      'Enter to confirm · Esc to cancel',
    ].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
  })

  it('rejects a lone option line', () => {
    const pane = ['❯ 1. Only option', '', 'Enter to confirm · Esc to cancel'].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
  })

  it('returns null on empty pane text', () => {
    expect(parsePaneChoiceMenu('')).toBeNull()
  })
})

/**
 * PAN-3212 — the blind-Enter guard. The tmux paste fallback used to press Enter
 * whenever it could not verify its paste, which at the resume gate confirmed
 * "Resume from summary" and discarded the operator's full session. The guard
 * must see every menu that blocks the pane, including the two shapes card
 * rendering skips.
 */
describe('paneHasBlockingChoiceMenu', () => {
  it('reports the resume gate', () => {
    expect(paneHasBlockingChoiceMenu(RESUME_GATE_MENU)).toBe(true)
  })

  it('reports permission menus the card path excludes', () => {
    const pane = [
      'Do you want to allow this Bash command?',
      '',
      '❯ 1. Yes',
      "  2. Yes, and don't ask again",
      '  3. No',
      '',
      'Esc to cancel · Tab to amend',
    ].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
    expect(paneHasBlockingChoiceMenu(pane)).toBe(true)
  })

  it('reports multi-select menus the card path excludes', () => {
    const pane = [
      'Pick the items to include:',
      '',
      '❯ 1. First',
      '  2. Second',
      '',
      'Space to select · Enter to confirm',
    ].join('\n')
    expect(parsePaneChoiceMenu(pane)).toBeNull()
    expect(paneHasBlockingChoiceMenu(pane)).toBe(true)
  })

  it('stays quiet on an idle composer, so normal delivery still submits', () => {
    const pane = [
      '● All done — the full task list is closed out.',
      '',
      '✻ Baked for 3m 37s',
      '',
      '─────────────────────────────',
      '❯ ',
      '─────────────────────────────',
    ].join('\n')
    expect(paneHasBlockingChoiceMenu(pane)).toBe(false)
  })

  it('stays quiet on a numbered prose list', () => {
    const pane = [
      'The plan is:',
      '1. Fix the parser',
      '2. Add tests',
      '3. Ship it',
      'Let me know which step to start with.',
    ].join('\n')
    expect(paneHasBlockingChoiceMenu(pane)).toBe(false)
  })

  it('stays quiet once the menu has been answered and output follows', () => {
    const pane = [RESUME_GATE_MENU, '', 'Resuming from summary…', '✻ Worked for 12s'].join('\n')
    expect(paneHasBlockingChoiceMenu(pane)).toBe(false)
  })
})

describe('buildChoiceKeystrokes', () => {
  const menu = parsePaneChoiceMenu(RESUME_GATE_MENU)!

  it('confirms in place when the target holds the cursor', () => {
    expect(buildChoiceKeystrokes(menu, 0)).toEqual(['Enter'])
  })

  it('arrows down to a lower option', () => {
    expect(buildChoiceKeystrokes(menu, 1)).toEqual(['Down', 'Enter'])
    expect(buildChoiceKeystrokes(menu, 2)).toEqual(['Down', 'Down', 'Enter'])
  })

  it('arrows up from a lower cursor row', () => {
    const cursorOnThree = parsePaneChoiceMenu(
      RESUME_GATE_MENU
        .replace('❯ 1. Resume from summary', '  1. Resume from summary')
        .replace("  3. Don't ask me again", "❯ 3. Don't ask me again"),
    )!
    expect(buildChoiceKeystrokes(cursorOnThree, 0)).toEqual(['Up', 'Up', 'Enter'])
  })

  it('clamps out-of-range selections', () => {
    expect(buildChoiceKeystrokes(menu, 99)).toEqual(['Down', 'Down', 'Enter'])
  })
})

describe('paneChoiceMenuSignature', () => {
  it('is stable across re-parses of the same menu', () => {
    expect(paneChoiceMenuSignature(parsePaneChoiceMenu(RESUME_GATE_MENU)!))
      .toBe(paneChoiceMenuSignature(parsePaneChoiceMenu(RESUME_GATE_MENU)!))
  })

  it('changes when an option label changes', () => {
    const changed = RESUME_GATE_MENU.replace("Don't ask me again", 'Never ask again')
    expect(paneChoiceMenuSignature(parsePaneChoiceMenu(changed)!))
      .not.toBe(paneChoiceMenuSignature(parsePaneChoiceMenu(RESUME_GATE_MENU)!))
  })
})
