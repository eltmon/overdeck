import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ProjectCiSnapshot } from '@overdeck/contracts'
import { useDashboardStore } from '../../../lib/store'
import { HomeMetaLine } from './HomeMetaLine'

vi.mock('../../CommandDeck/ProjectDeployChip', () => ({
  ProjectDeployChip: () => <span data-testid="deploy-chip" />,
}))
vi.mock('../../CommandDeck/ProjectTree/ProjectIdentityChip', () => ({
  ProjectIdentityChip: () => <span data-testid="identity-chip" />,
}))

const PROJECT_KEY = 'overdeck'
type Suite = ProjectCiSnapshot['suites'][string]

function ciRecord(suites: Record<string, Suite>): ProjectCiSnapshot {
  return {
    projectKey: PROJECT_KEY,
    repo: 'eltmon/overdeck',
    branch: 'main',
    headSha: '0123456789abcdef',
    suites,
    updatedAt: '2026-11-15T08:10:00.000Z',
  }
}

function releaseFixture(overrides: Record<string, unknown> = {}) {
  return {
    projectKey: PROJECT_KEY,
    available: true,
    repo: 'eltmon/overdeck',
    releaseWorkflow: 'release.yml',
    runs: [{
      id: 1,
      displayTitle: 'Release v1.2.0',
      tag: 'v1.2.0',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/eltmon/overdeck/actions/runs/1',
      createdAt: '2026-11-15T09:00:00.000Z',
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }],
    latestRunJobs: [],
    npmPackages: [],
    githubRelease: null,
    ...overrides,
  }
}

let release: Record<string, unknown> | null = null

function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}

beforeEach(() => {
  release = null
  useDashboardStore.setState({ ciByProjectKey: {} })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/projects/overdeck/release-status' && release) return Response.json(release)
    return new Response('not found', { status: 404 })
  }))
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HomeMetaLine (PAN-5294 G-D3)', () => {
  it('renders the path with the home directory as ~ and the branch', () => {
    render(<HomeMetaLine projectKey={PROJECT_KEY} path="/home/someone/Projects/overdeck" branch="main" />)

    const line = screen.getByTestId('home-meta-line')
    expect(line).toHaveTextContent('~/Projects/overdeck')
    expect(line).toHaveTextContent('main')
    expect(within(line).getByTestId('deploy-chip')).toBeInTheDocument()
    expect(within(line).getByTestId('identity-chip')).toBeInTheDocument()
  })

  it('says CI unknown without a CI record', () => {
    render(<HomeMetaLine projectKey={PROJECT_KEY} branch="main" />)
    expect(screen.getByText('CI unknown')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /CI/ })).not.toBeInTheDocument()
  })

  it('says CI passing, CI failing or CI running k/n from the project CI record', () => {
    useDashboardStore.setState({
      ciByProjectKey: { [PROJECT_KEY]: ciRecord({ '1': { status: 'completed', conclusion: 'success', htmlUrl: 'https://x/1' } }) },
    })
    const { rerender } = render(<HomeMetaLine projectKey={PROJECT_KEY} branch="main" />)
    const passing = screen.getByRole('link', { name: 'CI passing' })
    expect(passing).toHaveClass('text-state-done')
    fireEvent.click(passing)
    expect(window.open).toHaveBeenCalledWith('https://x/1', '_blank', 'noopener,noreferrer')

    useDashboardStore.setState({
      ciByProjectKey: { [PROJECT_KEY]: ciRecord({ '1': { status: 'completed', conclusion: 'failure', htmlUrl: 'https://x/1' } }) },
    })
    rerender(<HomeMetaLine projectKey={PROJECT_KEY} branch="main" />)
    expect(screen.getByRole('link', { name: 'CI failing' })).toHaveClass('text-destructive')

    useDashboardStore.setState({
      ciByProjectKey: {
        [PROJECT_KEY]: ciRecord({
          '1': { status: 'completed', conclusion: 'success', htmlUrl: 'https://x/1' },
          '2': { status: 'in_progress', conclusion: null, htmlUrl: 'https://x/2' },
          '3': { status: 'queued', conclusion: null, htmlUrl: 'https://x/3' },
        }),
      },
    })
    rerender(<HomeMetaLine projectKey={PROJECT_KEY} branch="main" />)
    expect(screen.getByRole('link', { name: 'CI running 1/3' })).toHaveClass('text-state-live')
  })

  it('names the latest successful release and opens the release panel in a popover', async () => {
    release = releaseFixture()
    render(<HomeMetaLine projectKey={PROJECT_KEY} branch="main" />)

    const segment = await screen.findByRole('button', { name: 'v1.2.0 released 2h ago' })
    expect(screen.queryByTestId('project-release-panel')).not.toBeInTheDocument()
    fireEvent.click(segment)
    expect(await screen.findByTestId('project-release-panel')).toBeInTheDocument()
  })

  it('says release failed for a completed run that did not succeed', async () => {
    release = releaseFixture({
      runs: [{ ...releaseFixture().runs[0], conclusion: 'failure' }],
    })
    render(<HomeMetaLine projectKey={PROJECT_KEY} branch="main" />)

    expect(await screen.findByRole('button', { name: 'v1.2.0 release failed' })).toHaveClass('text-destructive')
  })

  it('says no releases for a project with no publish pipeline', async () => {
    release = releaseFixture({ available: false, runs: [] })
    render(<HomeMetaLine projectKey={PROJECT_KEY} branch="main" />)

    expect(await screen.findByText('no releases')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'no releases' })).not.toBeInTheDocument()
  })
})
