import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProjectHome } from './ProjectHome'
import type { StageApi } from './types'

function api(overrides: Partial<StageApi> = {}): StageApi {
  return {
    deckKey: 'panopticon-cli',
    openPane: vi.fn(),
    openTypedPane: vi.fn(),
    openIssue: vi.fn(),
    openOrFocusAgentPane: vi.fn(),
    toggleTerminal: vi.fn(),
    ...overrides,
  }
}

describe('ProjectHome', () => {
  it('passes the launcher query into the created agent conversation', async () => {
    const openOrFocusAgentPane = vi.fn()
    const onCreateConversation = vi.fn().mockResolvedValue('conv-123')

    render(
      <ProjectHome
        projectName="panopticon-cli"
        onCreateConversation={onCreateConversation}
        api={api({ openOrFocusAgentPane })}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'This is a test' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(onCreateConversation).toHaveBeenCalledWith('claude-code', 'This is a test')
    })
    expect(openOrFocusAgentPane).toHaveBeenCalledWith('conv-123', 'Agent')
  })
})
