import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ShortcutsSheet } from '../ShortcutsSheet'
import { registerShortcut, resetShortcutsForTests, type ShortcutDef } from '../registry'

function def(overrides: Partial<ShortcutDef> & Pick<ShortcutDef, 'id' | 'keys' | 'label' | 'group'>): ShortcutDef {
  return { scope: 'global', run: () => {}, ...overrides }
}

beforeEach(() => {
  registerShortcut(def({ id: 'stop', keys: { mac: 'Meta+Shift+.', other: 'Ctrl+Shift+.' }, label: 'Emergency stop', group: 'Safety' }))
  registerShortcut(def({ id: 'palette', keys: { mac: 'Meta+K', other: 'Ctrl+K' }, label: 'Command palette', group: 'General' }))
  registerShortcut(def({ id: 'lens', keys: { mac: 'G P', other: 'G P' }, label: 'Go to Pipeline', group: 'Navigation' }))
  registerShortcut(def({ id: 'tab-1', keys: { mac: 'Meta+1', other: 'Ctrl+Alt+1' }, label: 'Go to tab 1–9', group: 'Tabs' }))
  registerShortcut(def({ id: 'tab-2', keys: { mac: 'Meta+2', other: 'Ctrl+Alt+2' }, label: 'Go to tab 2', group: 'Tabs', hidden: true }))
  registerShortcut(def({ id: 'terminal', keys: { mac: 'Meta+T', other: null }, label: 'Toggle terminal', group: 'Tabs' }))
})

afterEach(() => {
  resetShortcutsForTests()
  vi.restoreAllMocks()
})

describe('ShortcutsSheet', () => {
  it('lists the groups in order with their shortcuts', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    render(<ShortcutsSheet onClose={() => {}} />)
    expect(screen.getByText('Keyboard shortcuts')).toBeTruthy()
    const groups = screen.getAllByRole('region').map((section) => section.getAttribute('aria-label'))
    expect(groups).toEqual(['General', 'Navigation', 'Tabs', 'Safety'])
    expect(within(screen.getByRole('region', { name: 'Navigation' })).getByText('G then P')).toBeTruthy()
  })

  it('shows mac keycaps on macOS', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    render(<ShortcutsSheet onClose={() => {}} />)
    expect(screen.getByText('⌘K')).toBeTruthy()
    expect(screen.getByText('⌘⇧.')).toBeTruthy()
    expect(screen.getByText('Toggle terminal')).toBeTruthy()
  })

  it('shows Ctrl keycaps elsewhere and hides unbound and hidden rows', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    render(<ShortcutsSheet onClose={() => {}} />)
    expect(screen.getByText('Ctrl K')).toBeTruthy()
    expect(screen.getByText('Ctrl Alt 1')).toBeTruthy()
    expect(screen.queryByText('⌘K')).toBeNull()
    expect(screen.queryByText('Toggle terminal')).toBeNull()
    expect(screen.queryByText('Go to tab 2')).toBeNull()
  })
})
