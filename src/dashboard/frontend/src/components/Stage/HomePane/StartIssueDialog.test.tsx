import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDashboardStore } from '../../../lib/store'
import { useResumeRecovery } from '../../../lib/resumeRecovery'
import { useDeckDialogs } from '../../frame/deck/useIssueSessionActions'
import { installStrictFetchMock } from '../../../test-utils/strictFetchMock'
import type { ProjectFeature } from '../../CommandDeck/ProjectTree/ProjectNode'
import { StartIssueDialog } from './StartIssueDialog'

const mocks = vi.hoisted(() => ({
  refreshDashboardState: vi.fn(async () => {}),
  toastSuccess: vi.fn(),
}))
vi.mock('../../../lib/refresh-dashboard-state', () => ({ refreshDashboardState: mocks.refreshDashboardState }))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }))

function feature(issueId: string, overrides: Partial<ProjectFeature> = {}): ProjectFeature {
  return {
    issueId,
    title: `${issueId} title`,
    projectName: 'workflow',
    branch: `feature/${issueId.toLowerCase()}`,
    status: 'open',
    stateLabel: 'Todo',
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
    sessions: [],
    ...overrides,
  }
}

const FEATURES = [feature('WFX-1'), feature('WFX-2'), feature('WFX-3', {
  sessions: [{ type: 'work', presence: 'active' }] as ProjectFeature['sessions'],
})]

/** Each POST /api/agents takes the next queued response. */
let agentResponses: Array<() => Response> = []
let fetchControl: ReturnType<typeof installStrictFetchMock>

function postedBodies(): unknown[] {
  return fetchControl.fetchMock.mock.calls
    .filter(([url, init]) => String(url) === '/api/agents' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

function render(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  rtlRender(
    <QueryClientProvider client={client}>
      <StartIssueDialog prefix="WFX" features={FEATURES} onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

beforeEach(() => {
  agentResponses = []
  fetchControl = installStrictFetchMock(({ method, url }) => {
    if (method === 'POST' && url === '/api/agents') return agentResponses.shift()?.()
    return undefined
  })
  useDashboardStore.setState({
    issuesRaw: [],
    derivedIssueStateByIssueId: {
      'WFX-1': { issueId: 'WFX-1', state: 'backlog' },
      'WFX-2': { issueId: 'WFX-2', state: 'planned' },
      'WFX-3': { issueId: 'WFX-3', state: 'working' },
    },
  })
  useDeckDialogs.setState({ planDialogIssue: null })
  useResumeRecovery.setState({ request: null })
})

afterEach(async () => {
  cleanup()
  await fetchControl.assertNoUnexpectedRequests()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('StartIssueDialog (PAN-5294 G-D9)', () => {
  it('lists startable issues newest first and fills the input from a row', () => {
    render()

    const rows = screen.getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('WFX-2'),
      expect.stringContaining('WFX-1'),
    ])
    expect(screen.getByRole('textbox', { name: 'Issue' })).toHaveAttribute('placeholder', 'WFX-123')
    fireEvent.click(rows[1]!)
    expect(screen.getByRole('textbox', { name: 'Issue' })).toHaveValue('WFX-1')
  })

  it('starts a planned issue with one POST /api/agents', async () => {
    agentResponses.push(() => Response.json({ success: true }))
    const onClose = render()

    fireEvent.change(screen.getByRole('textbox', { name: 'Issue' }), { target: { value: 'WFX-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start WFX-2' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(postedBodies()).toEqual([{ issueId: 'WFX-2' }])
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Started WFX-2')
    expect(mocks.refreshDashboardState).toHaveBeenCalledTimes(1)
  })

  it('opens the plan dialog for an unplanned issue and posts nothing', () => {
    const onClose = render()

    fireEvent.change(screen.getByRole('textbox', { name: 'Issue' }), { target: { value: 'wfx-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Plan WFX-1…' }))

    expect(useDeckDialogs.getState().planDialogIssue?.identifier).toBe('WFX-1')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(postedBodies()).toEqual([])
  })

  it('shows guardrail warnings inside the dialog and Start anyway re-posts with the acknowledgement', async () => {
    agentResponses.push(() => Response.json(
      { requiresAcknowledgement: true, guardrails: { warnings: [{ message: 'CPU pressure is high' }] } },
      { status: 409 },
    ))
    agentResponses.push(() => Response.json({ success: true }))
    const onClose = render()

    fireEvent.change(screen.getByRole('textbox', { name: 'Issue' }), { target: { value: 'WFX-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start WFX-2' }))

    expect(await screen.findByText('CPU pressure is high')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Start anyway' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(postedBodies()).toEqual([{ issueId: 'WFX-2' }, { issueId: 'WFX-2', guardrailAcknowledged: true }])
  })

  it('closes and hands a start-block 409 to the recovery dialog', async () => {
    agentResponses.push(() => Response.json(
      { error: 'Agent is paused (operator)', agentId: 'agent-wfx-2', paused: true },
      { status: 409 },
    ))
    const onClose = render()

    fireEvent.change(screen.getByRole('textbox', { name: 'Issue' }), { target: { value: 'WFX-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start WFX-2' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(useResumeRecovery.getState().request).toMatchObject({ kind: 'paused', agentId: 'agent-wfx-2', issueId: 'WFX-2' })
  })

  it('shows a server error inline and stays open', async () => {
    agentResponses.push(() => Response.json({ error: 'boom' }, { status: 500 }))
    const onClose = render()

    fireEvent.change(screen.getByRole('textbox', { name: 'Issue' }), { target: { value: 'WFX-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start WFX-2' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(onClose).not.toHaveBeenCalled()
  })
})
