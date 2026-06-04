import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommitsPane } from './CommitsPane'
import type { StageContext } from '../types'
import type { WorkspacePane } from '../../../lib/panesStore'

vi.mock('../../CommandDeck/ZoneCOverviewTabs/PrDiffTab', () => ({
  PrDiffTab: ({ issueId }: { issueId: string }) => (
    <div data-testid="prdifftab" data-issue={issueId} />
  ),
}))

const ctx: StageContext = { workspaceId: 'PAN-1549', openPane: () => {} }
const pane: WorkspacePane = { paneId: 'c', paneType: 'commits', label: 'Commits', createdAt: 1 }

describe('CommitsPane', () => {
  it('renders PrDiffTab for the workspace issue', () => {
    render(<CommitsPane pane={pane} ctx={ctx} />)
    expect(screen.getByTestId('prdifftab')).toHaveAttribute('data-issue', 'PAN-1549')
  })
})
