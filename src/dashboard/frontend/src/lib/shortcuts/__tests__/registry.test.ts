import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHORD_TIMEOUT_MS, installShortcutListener, registerShortcut, resetShortcutsForTests, type ShortcutDef } from '../registry'

function def(overrides: Partial<ShortcutDef> & Pick<ShortcutDef, 'keys' | 'run'>): ShortcutDef {
  return { id: 'test', scope: 'not-editing', label: 'Test', group: 'General', ...overrides }
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

let platform: ReturnType<typeof vi.spyOn>
const mounted: HTMLElement[] = []

function mount<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el)
  mounted.push(el)
  return el
}

function html(markup: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.innerHTML = markup
  return mount(wrapper)
}

beforeEach(() => {
  platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
  installShortcutListener()
})

afterEach(() => {
  resetShortcutsForTests()
  for (const el of mounted.splice(0)) el.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('installShortcutListener', () => {
  it('adds exactly one capture and one bubble keydown listener, once', () => {
    resetShortcutsForTests()
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as Window
    const uninstall = installShortcutListener(target)
    const second = installShortcutListener(target)
    expect(target.addEventListener).toHaveBeenCalledTimes(2)
    expect(vi.mocked(target.addEventListener).mock.calls.map((c) => [c[0], c[2] === true])).toEqual([
      ['keydown', true],
      ['keydown', false],
    ])
    second()
    expect(target.removeEventListener).not.toHaveBeenCalled()
    uninstall()
    expect(target.removeEventListener).toHaveBeenCalledTimes(2)
  })
})

describe('platform mapping', () => {
  it('runs the mac spec on macOS and the other spec elsewhere', () => {
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'Meta+W', other: 'Ctrl+Alt+W' }, run }))

    platform.mockReturnValue('MacIntel')
    press(document.body, { key: 'w', ctrlKey: true, altKey: true })
    expect(run).not.toHaveBeenCalled()
    press(document.body, { key: 'w', metaKey: true })
    expect(run).toHaveBeenCalledTimes(1)

    platform.mockReturnValue('Linux x86_64')
    press(document.body, { key: 'w', metaKey: true })
    expect(run).toHaveBeenCalledTimes(1)
    press(document.body, { key: 'w', ctrlKey: true, altKey: true })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('skips a shortcut unbound on the current platform', () => {
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'Meta+T', other: null }, run }))
    const event = press(document.body, { key: 't', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('scope', () => {
  it('does not run a not-editing shortcut in text fields, terminals or Monaco', () => {
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'N', other: 'N' }, run }))
    const root = html(`
      <input id="i" />
      <textarea id="t"></textarea>
      <div id="ce" contenteditable="true"><span id="ce-child">x</span></div>
      <div class="xterm"><textarea id="xt"></textarea></div>
      <div class="monaco-editor"><textarea id="mt"></textarea></div>
    `)
    for (const id of ['i', 't', 'ce', 'ce-child', 'xt', 'mt']) {
      press(root.querySelector(`#${id}`) as Element, { key: 'n' })
    }
    expect(run).not.toHaveBeenCalled()
    press(document.body, { key: 'n' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('uses document.activeElement when the event targets document or window', () => {
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'N', other: 'N' }, run }))
    const input = mount(document.createElement('input'))
    input.focus()
    press(document, { key: 'n' })
    expect(run).not.toHaveBeenCalled()
    input.blur()
    press(window, { key: 'n' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs a global shortcut inside Monaco before the editor sees the key (AC-S6)', () => {
    const run = vi.fn()
    registerShortcut(def({ scope: 'global', keys: { mac: 'Meta+P', other: 'Ctrl+P' }, run }))
    const root = html('<div class="monaco-editor"><textarea></textarea></div>')
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement
    const editorOwn = vi.fn((e: Event) => e.stopPropagation())
    textarea.addEventListener('keydown', editorOwn)
    textarea.focus()
    const event = press(textarea, { key: 'p', ctrlKey: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(editorOwn).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a global key to a terminal that consumes it, and runs it once when the terminal lets it pass', () => {
    const run = vi.fn()
    registerShortcut(def({ scope: 'global', keys: { mac: 'Meta+K', other: 'Ctrl+K' }, run }))
    const root = html('<div class="xterm"><textarea></textarea></div>')
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement
    const consume = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    textarea.addEventListener('keydown', consume)
    press(textarea, { key: 'k', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()

    textarea.removeEventListener('keydown', consume)
    press(textarea, { key: 'k', ctrlKey: true })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('lets a document capture listener that stops g keep a chord from arming (useTypeToFocus)', () => {
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'G P', other: 'G P' }, run }))
    const typeToFocus = (e: KeyboardEvent) => {
      if (e.key === 'g') e.stopPropagation()
    }
    document.addEventListener('keydown', typeToFocus, true)
    try {
      press(document.body, { key: 'g' })
      press(document.body, { key: 'p' })
      expect(run).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', typeToFocus, true)
    }
  })

  it('skips events another handler already claimed, and composing events', () => {
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'N', other: 'N' }, run }))
    const button = mount(document.createElement('button'))
    button.addEventListener('keydown', (e) => e.preventDefault())
    press(button, { key: 'n' })
    press(document.body, { key: 'n', isComposing: true })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('chords', () => {
  it('runs g then p within the timeout', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'G P', other: 'G P' }, run }))
    const g = press(document.body, { key: 'g' })
    expect(g.defaultPrevented).toBe(true)
    vi.advanceTimersByTime(CHORD_TIMEOUT_MS - 100)
    press(document.body, { key: 'p' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not run p after the chord timed out', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'G P', other: 'G P' }, run }))
    press(document.body, { key: 'g' })
    vi.advanceTimersByTime(CHORD_TIMEOUT_MS + 1)
    press(document.body, { key: 'p' })
    expect(run).not.toHaveBeenCalled()
  })

  it('cancels the chord on an unbound second key', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'G P', other: 'G P' }, run }))
    press(document.body, { key: 'g' })
    press(document.body, { key: 'q' })
    press(document.body, { key: 'p' })
    expect(run).not.toHaveBeenCalled()
  })

  it('consumes a non-completing second key', () => {
    vi.useFakeTimers()
    const chord = vi.fn()
    const search = vi.fn()
    registerShortcut(def({ id: 'chord', keys: { mac: 'G P', other: 'G P' }, run: chord }))
    registerShortcut(def({ id: 'search', keys: { mac: '/', other: '/' }, run: search }))
    press(document.body, { key: 'g' })
    press(document.body, { key: '/' })
    expect(search).not.toHaveBeenCalled()
    expect(chord).not.toHaveBeenCalled()
    press(document.body, { key: '/' })
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('ignores a modifier-only keydown between the two steps', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    registerShortcut(def({ keys: { mac: 'G P', other: 'G P' }, run }))
    press(document.body, { key: 'g' })
    press(document.body, { key: 'Shift', shiftKey: true })
    press(document.body, { key: 'p' })
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('registration order and conditions', () => {
  it('runs the newest registration and restores the older one on unregister', () => {
    const older = vi.fn()
    const newer = vi.fn()
    registerShortcut(def({ id: 'older', keys: { mac: 'N', other: 'N' }, run: older }))
    const unregister = registerShortcut(def({ id: 'newer', keys: { mac: 'N', other: 'N' }, run: newer }))
    press(document.body, { key: 'n' })
    expect(newer).toHaveBeenCalledTimes(1)
    expect(older).not.toHaveBeenCalled()
    unregister()
    press(document.body, { key: 'n' })
    expect(older).toHaveBeenCalledTimes(1)
  })

  it('lets the event through untouched when when() is false or throws', () => {
    const run = vi.fn()
    registerShortcut(def({ id: 'off', keys: { mac: 'N', other: 'N' }, run, when: () => false }))
    registerShortcut(
      def({
        id: 'broken',
        keys: { mac: 'N', other: 'N' },
        run,
        when: () => {
          throw new Error('boom')
        },
      }),
    )
    const event = press(document.body, { key: 'n' })
    expect(run).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('stops propagation of a handled global key', () => {
    const run = vi.fn()
    registerShortcut(def({ scope: 'global', keys: { mac: 'Meta+K', other: 'Ctrl+K' }, run }))
    const later = vi.fn()
    window.addEventListener('keydown', later)
    try {
      press(document.body, { key: 'k', ctrlKey: true })
      expect(run).toHaveBeenCalledTimes(1)
      expect(later).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', later)
    }
  })
})
