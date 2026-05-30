import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DocsPane } from './DocsPane'
import type { StageContext } from '../types'
import type { WorkspacePane } from '../../../lib/panesStore'

const planningData = { prd: '# PRD body', state: '# STATE body', inference: '# INFER body' }
let hasInference = true

vi.mock('../../CommandDeck/ZoneCOverviewTabs/queries', () => ({
  usePlanningQuery: () => ({ data: planningData, isLoading: false }),
  usePlanningSummaryQuery: () => ({ data: { hasInference } }),
}))
vi.mock('../../CommandDeck/ZoneCOverviewTabs/MarkdownTab', () => ({
  MarkdownTab: ({ body }: { body?: string | null }) => <div data-testid="md">{body}</div>,
}))

const ctx: StageContext = { workspaceId: 'PAN-1549', openPane: () => {} }
const pane = (over: Partial<WorkspacePane> = {}): WorkspacePane => ({
  paneId: 'd',
  paneType: 'docs',
  label: 'Docs',
  createdAt: 1,
  ...over,
})

beforeEach(() => {
  hasInference = true
})

describe('DocsPane', () => {
  it('defaults to PRD and switches docs via the selector', () => {
    render(<DocsPane pane={pane()} ctx={ctx} />)
    expect(screen.getByTestId('md')).toHaveTextContent('PRD body')

    fireEvent.click(screen.getByRole('tab', { name: 'STATE' }))
    expect(screen.getByTestId('md')).toHaveTextContent('STATE body')

    fireEvent.click(screen.getByRole('tab', { name: 'INFERENCE' }))
    expect(screen.getByTestId('md')).toHaveTextContent('INFER body')
  })

  it('hides the INFERENCE tab when no inference content exists', () => {
    hasInference = false
    render(<DocsPane pane={pane()} ctx={ctx} />)
    expect(screen.queryByRole('tab', { name: 'INFERENCE' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'PRD' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'STATE' })).toBeTruthy()
  })

  it('honors pane.docFilePath as the initial doc', () => {
    render(<DocsPane pane={pane({ docFilePath: 'state' })} ctx={ctx} />)
    expect(screen.getByTestId('md')).toHaveTextContent('STATE body')
  })
})
