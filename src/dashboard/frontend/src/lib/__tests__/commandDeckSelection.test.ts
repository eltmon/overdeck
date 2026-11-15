/**
 * Unit tests for the per-issue Command Deck selection slice (PAN-830, pan-11sr).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  useCommandDeckSelection,
  selectSelectedSessionForIssue,
  selectIsIssueSelected,
} from '../commandDeckSelection'

beforeEach(() => {
  useCommandDeckSelection.getState().clearAll()
  useCommandDeckSelection.setState({ selectedConversation: null, selectedFeature: null })
})

describe('useCommandDeckSelection', () => {
  it('starts with no selections', () => {
    expect(useCommandDeckSelection.getState().selectedSessionByIssue).toEqual({})
  })

  it('selectSession records the session for an issue', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    expect(useCommandDeckSelection.getState().selectedSessionByIssue).toEqual({
      'PAN-1': 'session-a',
    })
  })

  it('selectSession with null sets issue-selected mode without removing the key', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    useCommandDeckSelection.getState().selectSession('PAN-1', null)
    expect(useCommandDeckSelection.getState().selectedSessionByIssue).toEqual({ 'PAN-1': null })
  })

  it('selectSession replaces an existing selection', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-b')
    expect(
      useCommandDeckSelection.getState().selectedSessionByIssue['PAN-1'],
    ).toBe('session-b')
  })

  it('keeps per-issue selections independent', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    useCommandDeckSelection.getState().selectSession('PAN-2', 'session-b')
    useCommandDeckSelection.getState().selectSession('PAN-1', null)

    expect(useCommandDeckSelection.getState().selectedSessionByIssue).toEqual({
      'PAN-1': null,
      'PAN-2': 'session-b',
    })
  })

  it('clearIssue removes the issue from the map', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    useCommandDeckSelection.getState().selectSession('PAN-2', 'session-b')
    useCommandDeckSelection.getState().clearIssue('PAN-1')

    const map = useCommandDeckSelection.getState().selectedSessionByIssue
    expect(map).not.toHaveProperty('PAN-1')
    expect(map['PAN-2']).toBe('session-b')
  })

  it('clearIssue is a no-op when the issue is absent', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    const before = useCommandDeckSelection.getState().selectedSessionByIssue
    useCommandDeckSelection.getState().clearIssue('PAN-99')
    expect(useCommandDeckSelection.getState().selectedSessionByIssue).toBe(before)
  })

  it('clearAll resets the entire map', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    useCommandDeckSelection.getState().selectSession('PAN-2', 'session-b')
    useCommandDeckSelection.getState().clearAll()
    expect(useCommandDeckSelection.getState().selectedSessionByIssue).toEqual({})
  })
})

describe('selectSelectedSessionForIssue', () => {
  it('returns null when the issue has no entry', () => {
    const state = useCommandDeckSelection.getState()
    expect(selectSelectedSessionForIssue('PAN-1')(state)).toBeNull()
  })

  it('returns the sessionId when one is selected', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    const state = useCommandDeckSelection.getState()
    expect(selectSelectedSessionForIssue('PAN-1')(state)).toBe('session-a')
  })

  it('returns null when the issue is in issue-selected mode (explicit null)', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', null)
    const state = useCommandDeckSelection.getState()
    expect(selectSelectedSessionForIssue('PAN-1')(state)).toBeNull()
  })
})

describe('selectIsIssueSelected', () => {
  it('returns true when no entry exists', () => {
    const state = useCommandDeckSelection.getState()
    expect(selectIsIssueSelected('PAN-1')(state)).toBe(true)
  })

  it('returns true when the entry is explicitly null', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', null)
    const state = useCommandDeckSelection.getState()
    expect(selectIsIssueSelected('PAN-1')(state)).toBe(true)
  })

  it('returns false when a session is selected', () => {
    useCommandDeckSelection.getState().selectSession('PAN-1', 'session-a')
    const state = useCommandDeckSelection.getState()
    expect(selectIsIssueSelected('PAN-1')(state)).toBe(false)
  })
})

describe('deck selection fields (PAN-5293 F-D1)', () => {
  it('start as null', () => {
    const state = useCommandDeckSelection.getState()
    expect(state.selectedConversation).toBeNull()
    expect(state.selectedFeature).toBeNull()
  })

  it('setters record the conversation and the issue, and clearAll preserves both', () => {
    useCommandDeckSelection.getState().setSelectedConversation('a')
    useCommandDeckSelection.getState().setSelectedFeature('PAN-1')
    expect(useCommandDeckSelection.getState().selectedConversation).toBe('a')
    expect(useCommandDeckSelection.getState().selectedFeature).toBe('PAN-1')

    useCommandDeckSelection.getState().clearAll()
    expect(useCommandDeckSelection.getState().selectedConversation).toBe('a')
    expect(useCommandDeckSelection.getState().selectedFeature).toBe('PAN-1')
  })

  it('setters accept null', () => {
    useCommandDeckSelection.getState().setSelectedConversation('a')
    useCommandDeckSelection.getState().setSelectedFeature('PAN-1')
    useCommandDeckSelection.getState().setSelectedConversation(null)
    useCommandDeckSelection.getState().setSelectedFeature(null)
    expect(useCommandDeckSelection.getState().selectedConversation).toBeNull()
    expect(useCommandDeckSelection.getState().selectedFeature).toBeNull()
  })
})
