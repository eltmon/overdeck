import { beforeEach, describe, expect, it, vi } from 'vitest'

import { draftKey } from '../code-drafts'
import { carryViewStates, registerCodeEditor, resetViewStateRegistryForTests, takeViewState } from '../view-state-registry'

function editor(state: unknown, focused = false) {
  return { saveViewState: vi.fn(() => state), restoreViewState: vi.fn(), hasTextFocus: vi.fn(() => focused), focus: vi.fn() } as unknown as Parameters<typeof registerCodeEditor>[1]
}

beforeEach(() => {
  resetViewStateRegistryForTests()
})

describe('view-state registry (PAN-5290 C-D12)', () => {
  it('carries a live editor on the old root to the same path on the new root', () => {
    registerCodeEditor(draftKey('project:p', 'docs/a.md'), editor({ cursor: 7 }, true))
    carryViewStates('project:p', 'workspace:w')
    expect(takeViewState(draftKey('workspace:w', 'docs/a.md'))).toEqual({ viewState: { cursor: 7 }, focused: true })
  })

  it('ignores editors outside the from-root prefix and forgets a taken state', () => {
    registerCodeEditor(draftKey('project:pq', 'docs/a.md'), editor({ cursor: 1 }))
    registerCodeEditor(draftKey('issue:PAN-1', 'docs/a.md'), editor({ cursor: 2 }))
    registerCodeEditor(draftKey('project:p', 'docs/b.md'), editor({ cursor: 3 }))
    carryViewStates('project:p', 'workspace:w')
    expect(takeViewState(draftKey('workspace:w', 'docs/a.md'))).toBeNull()
    expect(takeViewState(draftKey('workspace:w', 'docs/b.md'))).toEqual({ viewState: { cursor: 3 }, focused: false })
    expect(takeViewState(draftKey('workspace:w', 'docs/b.md'))).toBeNull()
  })

  it('carries nothing for an unregistered editor', () => {
    const unregister = registerCodeEditor(draftKey('project:p', 'docs/a.md'), editor({ cursor: 7 }))
    unregister()
    carryViewStates('project:p', 'workspace:w')
    expect(takeViewState(draftKey('workspace:w', 'docs/a.md'))).toBeNull()
  })

  it('prefers the focused editor when two panes show the file', () => {
    registerCodeEditor(draftKey('project:p', 'a.ts'), editor({ cursor: 1 }, true))
    registerCodeEditor(draftKey('project:p', 'a.ts'), editor({ cursor: 2 }))
    carryViewStates('project:p', 'workspace:w')
    expect(takeViewState(draftKey('workspace:w', 'a.ts'))).toEqual({ viewState: { cursor: 1 }, focused: true })
  })
})
