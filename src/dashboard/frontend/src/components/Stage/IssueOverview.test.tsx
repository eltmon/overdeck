import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { IssueOverview } from './IssueOverview'
import type { StageApi } from './types'

vi.mock('./cockpit/IssueMissionControl', () => ({
  IssueMissionControl: ({ launcher }: { launcher: ReactNode }) => <>{launcher}</>,
}))

function api(overrides: Partial<StageApi> = {}): StageApi {
  return {
    deckKey: 'overdeck',
    openPane: vi.fn(),
    openTypedPane: vi.fn(),
    openIssue: vi.fn(),
    openOrFocusAgentPane: vi.fn(),
    toggleTerminal: vi.fn(),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('IssueOverview', () => {
  it('renders conversation creation errors inline without opening a pane', async () => {
    const openOrFocusAgentPane = vi.fn()
    const onCreateConversation = vi.fn().mockResolvedValue({ error: 'Unknown project: overdeck' })

    render(
      <IssueOverview
        issueId="PAN-2773"
        title="Command Deck launch errors"
        onCreateConversation={onCreateConversation}
        api={api({ openOrFocusAgentPane })}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Keep this query' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown project: overdeck')
    expect(input).toHaveValue('Keep this query')
    expect(openOrFocusAgentPane).not.toHaveBeenCalled()
  })

  it('suppresses repeated submissions while creation is pending', async () => {
    const pending = deferred<{ name: string } | { error: string }>()
    const onCreateConversation = vi.fn().mockReturnValue(pending.promise)

    render(
      <IssueOverview
        issueId="PAN-2773"
        title="Command Deck launch errors"
        onCreateConversation={onCreateConversation}
        api={api()}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Only once' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCreateConversation).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateConversation).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve({ error: 'Unknown project: overdeck' })
      await pending.promise
    })
  })

  it('clears the previous error on retry and opens the successful conversation', async () => {
    const retry = deferred<{ name: string } | { error: string }>()
    const openOrFocusAgentPane = vi.fn()
    const onCreateConversation = vi.fn()
      .mockResolvedValueOnce({ error: 'Unknown project: overdeck' })
      .mockReturnValueOnce(retry.promise)

    render(
      <IssueOverview
        issueId="PAN-2773"
        title="Command Deck launch errors"
        onCreateConversation={onCreateConversation}
        api={api({ openOrFocusAgentPane })}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Retry this query' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown project: overdeck')

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCreateConversation).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => {
      retry.resolve({ name: 'conv-789' })
      await retry.promise
    })
    expect(openOrFocusAgentPane).toHaveBeenCalledWith('conv-789', 'Agent')
  })
})
