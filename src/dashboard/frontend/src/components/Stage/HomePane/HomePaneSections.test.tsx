import { describe, it, expect } from 'vitest'
import { vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HomePaneSections, CollapsibleSection } from './HomePaneSections'

vi.mock('../../CommandDeck/ZoneCOverviewTabs/OverviewTab', () => ({
  OverviewTab: ({ issueId }: { issueId: string }) => <div data-testid="overview" data-issue={issueId} />,
}))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/ActivityTab', () => ({
  ActivityTab: ({ issueId }: { issueId: string }) => <div data-testid="activity" data-issue={issueId} />,
}))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/DiscussionsTab', () => ({
  DiscussionsTab: ({ issueId }: { issueId: string }) => <div data-testid="discussions" data-issue={issueId} />,
}))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/CostsTab', () => ({
  CostsTab: ({ issueId }: { issueId: string }) => <div data-testid="costs" data-issue={issueId} />,
}))

describe('CollapsibleSection', () => {
  it('hides content until expanded', () => {
    render(
      <CollapsibleSection title="Section">
        <div data-testid="content" />
      </CollapsibleSection>,
    )
    expect(screen.queryByTestId('content')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Section/ }))
    expect(screen.getByTestId('content')).toBeTruthy()
  })
})

describe('HomePaneSections', () => {
  it('renders the Overview section (open by default) for the issue', () => {
    render(<HomePaneSections issueId="PAN-1549" />)
    expect(screen.getByTestId('overview')).toHaveAttribute('data-issue', 'PAN-1549')
  })

  it('reveals Activity, Discussions, and Costs when expanded', () => {
    render(<HomePaneSections issueId="PAN-1549" />)
    // Collapsed by default.
    expect(screen.queryByTestId('activity')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Activity/ }))
    expect(screen.getByTestId('activity')).toHaveAttribute('data-issue', 'PAN-1549')

    fireEvent.click(screen.getByRole('button', { name: /Discussions/ }))
    expect(screen.getByTestId('discussions')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Costs/ }))
    expect(screen.getByTestId('costs')).toBeTruthy()
  })
})
