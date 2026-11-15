import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render as rtlRender, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectHome } from './ProjectHome'
import type { StageApi } from './types'
import type { ProjectFeature } from '../CommandDeck/ProjectTree/ProjectNode'
import type { AgentsWorking } from '../../lib/selectors/agentsWorking'
import type { NeedsYouItem } from '../../lib/selectors/needsYou'
import { useDashboardStore } from '../../lib/store'

const mocks = vi.hoisted(() => ({
  openMainCheckout: vi.fn<(projectKey: string) => Promise<void>>(),
  useAgentsWorking: vi.fn(),
  useNeedsYouItems: vi.fn(),
  useCreateConversation: vi.fn(),
  create: vi.fn(async () => ({ name: 'conv-new' })),
}))

vi.mock('../workspace/openMainWorkspace', () => ({
  useOpenMainCheckout: () => ({ open: mocks.openMainCheckout, opening: false }),
}))
vi.mock('../../lib/selectors/agentsWorking', () => ({ useAgentsWorking: mocks.useAgentsWorking }))
vi.mock('../../lib/selectors/needsYou', () => ({ useNeedsYouItems: mocks.useNeedsYouItems }))
vi.mock('../frame/deck/useCreateConversation', () => ({ useCreateConversation: mocks.useCreateConversation }))
vi.mock('../PanOpenInPicker', () => ({
  EDITOR_LABELS: {},
  useAvailableEditors: () => ({ editors: [], defaultCwd: null, preferred: null }),
  openFolderInEditor: vi.fn(),
}))
vi.mock('../CommandDeck/ProjectSettingsDisclosure', () => ({
  ProjectSettingsSection: ({ projectKey }: { projectKey: string }) => <div data-testid="project-settings-section" data-project={projectKey} />,
}))
vi.mock('../CommandDeck/ProjectDeployChip', () => ({ ProjectDeployChip: () => null }))
vi.mock('../CommandDeck/ProjectTree/ProjectIdentityChip', () => ({ ProjectIdentityChip: () => null }))
vi.mock('../merge-train/train/MergeTrain', () => ({ MergeTrain: () => <div data-testid="merge-train" /> }))

function agents(count = 0): AgentsWorking {
  return {
    count,
    byRole: { planning: 0, building: count, review: 0, test: 0, conversation: 0, other: 0 },
    rows: [],
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function installFetch() {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/registered-projects') {
      return Response.json([
        { key: 'overdeck', name: 'Overdeck', path: '/home/someone/overdeck', linearTeam: 'PAN', githubRepo: 'eltmon/overdeck' },
        { key: 'myn', name: 'Mind Your Now', path: '/home/someone/myn', linearTeam: null, githubRepo: null },
      ])
    }
    if (url.endsWith('/release-status')) return Response.json({ available: false, runs: [] })
    if (url.endsWith('/changes?since=7d')) return Response.json({ projectKey: 'overdeck', branch: 'main', commits: [] })
    if (url.startsWith('/api/costs/summary')) return Response.json({ week: { totalCost: 12 }, today: { totalCost: 3 } })
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

function api(overrides: Partial<StageApi> = {}): StageApi {
  return {
    deckKey: 'overdeck',
    openPane: vi.fn(),
    openTypedPane: vi.fn(),
    openIssue: vi.fn(),
    openOrFocusAgentPane: vi.fn(),
    toggleTerminal: vi.fn(),
    openTerminalDrawer: vi.fn(),
    openDock: vi.fn(),
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

function feature(issueId: string, overrides: Partial<ProjectFeature> = {}): ProjectFeature {
  return {
    issueId,
    title: `${issueId} title`,
    projectName: 'overdeck',
    branch: `feature/${issueId.toLowerCase()}`,
    status: 'open',
    stateLabel: 'In Progress',
    agentStatus: null,
    hasPlanning: false,
    hasPrd: false,
    hasState: false,
    isShadow: false,
    sessions: [],
    ...overrides,
  }
}

function chooseAgent(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: 'New conversation options' }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

beforeEach(() => {
  installFetch()
  mocks.useAgentsWorking.mockReturnValue(agents())
  mocks.useNeedsYouItems.mockReturnValue([])
  mocks.useCreateConversation.mockReturnValue({ create: mocks.create, createForAgent: vi.fn() })
  useDashboardStore.setState({ derivedIssueStateByIssueId: {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ProjectHome', () => {
  it("the New conversation caret's Claude Code item creates a claude-code conversation and opens its pane", async () => {
    const openOrFocusAgentPane = vi.fn()
    const onCreateConversation = vi.fn().mockResolvedValue({ name: 'conv-123' })
    render(<ProjectHome projectName="overdeck" onCreateConversation={onCreateConversation} api={api({ openOrFocusAgentPane })} />)

    chooseAgent(/Claude Code/)

    await waitFor(() => {
      expect(onCreateConversation).toHaveBeenCalledWith('claude-code', undefined, 'terminal')
    })
    expect(openOrFocusAgentPane).toHaveBeenCalledWith('conv-123', 'Agent')
  })

  it('the New conversation main part quick-creates in the same deck as the left column', () => {
    render(<ProjectHome projectName="Overdeck" projectKey="overdeck" api={api({ deckKey: 'overdeck' })} />)

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))

    expect(mocks.useCreateConversation).toHaveBeenCalledWith('overdeck')
    expect(mocks.create).toHaveBeenCalledWith('overdeck')
  })

  it('the Terminal action toggles the terminal', () => {
    const toggleTerminal = vi.fn()
    render(<ProjectHome projectName="overdeck" api={api({ toggleTerminal })} />)

    fireEvent.click(screen.getByRole('button', { name: /^Terminal/ }))

    expect(toggleTerminal).toHaveBeenCalledTimes(1)
  })

  it('renders conversation creation errors inline without opening a pane', async () => {
    const openOrFocusAgentPane = vi.fn()
    const onCreateConversation = vi.fn().mockResolvedValue({ error: 'Unknown project: overdeck' })
    render(<ProjectHome projectName="overdeck" onCreateConversation={onCreateConversation} api={api({ openOrFocusAgentPane })} />)

    chooseAgent(/Codex/)

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown project: overdeck')
    expect(onCreateConversation).toHaveBeenCalledWith('codex', undefined, 'terminal')
    expect(openOrFocusAgentPane).not.toHaveBeenCalled()
  })

  it('suppresses repeated submissions while creation is pending', async () => {
    const pending = deferred<{ name: string } | { error: string }>()
    const onCreateConversation = vi.fn().mockReturnValue(pending.promise)
    render(<ProjectHome projectName="overdeck" onCreateConversation={onCreateConversation} api={api()} />)

    chooseAgent(/Claude Code/)
    await waitFor(() => expect(onCreateConversation).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'New conversation options' }))
    const item = screen.getByRole('menuitem', { name: /Claude Code/ })
    expect(item).toBeDisabled()
    fireEvent.click(item)
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
    render(<ProjectHome projectName="overdeck" onCreateConversation={onCreateConversation} api={api({ openOrFocusAgentPane })} />)

    chooseAgent(/Claude Code/)
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown project: overdeck')

    chooseAgent(/Claude Code/)
    await waitFor(() => expect(onCreateConversation).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => {
      retry.resolve({ name: 'conv-456' })
      await retry.promise
    })
    expect(openOrFocusAgentPane).toHaveBeenCalledWith('conv-456', 'Agent')
  })

  it('the Settings button opens the project settings modal', () => {
    render(<ProjectHome projectName="Mind Your Now" projectKey="myn" api={api({ deckKey: 'myn' })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = screen.getByRole('dialog', { name: 'Project settings' })
    expect(within(dialog).getByTestId('project-settings-section')).toHaveAttribute('data-project', 'myn')
  })

  it('opens the work dock on Files (PAN-5289)', () => {
    const openPane = vi.fn()
    const openDock = vi.fn()
    render(<ProjectHome projectName="Overdeck" projectKey="overdeck" api={api({ openPane, openDock })} />)

    fireEvent.click(screen.getByRole('button', { name: /^Files/ }))

    expect(openDock).toHaveBeenCalledWith({ tab: 'files' })
    expect(openPane).not.toHaveBeenCalled()
  })

  it('renders no Files button without a project key', () => {
    render(<ProjectHome projectName="No project" api={api({ deckKey: '__no-project__' })} />)

    expect(screen.queryByRole('button', { name: /^Files/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    expect(screen.getByRole('menuitem', { name: 'Web page' })).toBeInTheDocument()
  })

  it('opens the main checkout of a registered project through More ▾', () => {
    render(<ProjectHome projectName="Mind Your Now" projectKey="myn" api={api({ deckKey: 'myn' })} />)

    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Main checkout' }))

    expect(mocks.openMainCheckout).toHaveBeenCalledWith('myn')
  })

  it('omits project settings and settings requests without a project key', async () => {
    render(<ProjectHome projectName="No project" api={api({ deckKey: '__no-project__' })} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/registered-projects'))
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/projects/'))).toBe(false)
  })

  it('reads the shared selectors with the project key and shows their Agents working count', async () => {
    mocks.useAgentsWorking.mockReturnValue(agents(4))
    render(<ProjectHome projectName="Overdeck" projectKey="overdeck" api={api()} />)

    expect(mocks.useAgentsWorking).toHaveBeenCalledWith({ projectKey: 'overdeck' })
    expect(mocks.useNeedsYouItems).toHaveBeenCalledWith({ projectKey: 'overdeck' })
    const fact = screen.getByRole('button', { name: /^Agents working/ })
    expect(fact.querySelector('[data-fact-value]')).toHaveTextContent('4')
    expect(await screen.findByRole('heading', { name: 'Overdeck' })).toBeInTheDocument()
    expect(await screen.findByText('eltmon/overdeck')).toBeInTheDocument()
  })

  it('renders only the title and the core actions on the no-project deck', () => {
    mocks.useNeedsYouItems.mockReturnValue([{ key: 'issue:PAN-1', kind: 'issue', title: 'x', ask: 'y', open: vi.fn() }] satisfies NeedsYouItem[])
    render(<ProjectHome projectName="No project" api={api({ deckKey: '__no-project__' })} />)

    expect(screen.getByRole('heading', { name: 'No project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Terminal/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^More/ })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Project facts' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Pipeline' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Recent changes on main' })).toBeNull()
    expect(screen.queryByTestId('home-meta-line')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Rename/ })).toBeNull()
  })

  it('shows facts and recent changes but no Pipeline for a registered project with no issues', () => {
    render(<ProjectHome projectName="Overdeck" projectKey="overdeck" features={[]} onSelectFeature={vi.fn()} api={api()} />)

    expect(screen.getByRole('group', { name: 'Project facts' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recent changes on main' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pipeline' })).toBeNull()
    expect(screen.getByTestId('merge-train')).toBeInTheDocument()
  })

  it('renders the Pipeline with needs-you tags from the shared list when issues are loaded', () => {
    mocks.useNeedsYouItems.mockReturnValue([
      { key: 'issue:PAN-2', kind: 'issue', title: 'PAN-2 title', ask: 'Approve the plan', open: vi.fn() },
    ] satisfies NeedsYouItem[])
    render(
      <ProjectHome
        projectName="Overdeck"
        projectKey="overdeck"
        features={[feature('PAN-1', { agentStatus: 'running' }), feature('PAN-2', { stateLabel: 'In Review' })]}
        onSelectFeature={vi.fn()}
        api={api()}
      />,
    )

    expect(screen.getByRole('region', { name: 'Pipeline' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Needs you' })).toHaveTextContent('Approve the plan')
    const row = screen.getAllByTestId('pipeline-row').find((el) => el.getAttribute('data-issue-id') === 'PAN-2')!
    expect(row).toHaveAttribute('data-needs-you', 'true')
    const inReview = screen.getByRole('button', { name: /^In review/ })
    expect(inReview.querySelector('[data-fact-value]')).toHaveTextContent('1')
  })
})
