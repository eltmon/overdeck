import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { PlanPane } from './PlanPane'
import type { StageContext } from '../types'
import type { WorkspacePane } from '../../../lib/panesStore'

vi.mock('../../CommandDeck/ZoneCOverviewTabs/VBriefTab', () => ({
  VBriefTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="vbrieftab" data-issue={issueId} />
  ),
}))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/BeadsTab', () => ({
  BeadsTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="beadstab" data-issue={issueId} />
  ),
}))

const ctx: StageContext = { workspaceId: 'PAN-1549', openPane: () => {} }
const pane: WorkspacePane = { paneId: 'p', paneType: 'plan', label: 'Plan', createdAt: 1 }

describe('PlanPane', () => {
  it('renders VBriefTab for the workspace issue by default', () => {
    render(<PlanPane pane={pane} ctx={ctx} />)
    expect(screen.getByTestId('vbrieftab')).toHaveAttribute('data-issue', 'PAN-1549')
    expect(screen.queryByTestId('beadstab')).toBeNull()
  })

  it('toggles to BeadsTab', () => {
    render(<PlanPane pane={pane} ctx={ctx} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Beads' }))
    expect(screen.getByTestId('beadstab')).toHaveAttribute('data-issue', 'PAN-1549')
    expect(screen.queryByTestId('vbrieftab')).toBeNull()
  })
})
