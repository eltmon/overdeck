/** PAN-5191 WI-F12: the edit-workspace HTTP client. */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({
    'Content-Type': 'application/json',
    'x-overdeck-csrf-token': 'csrf-1',
  })),
}))

const { ExplorerHttpError } = await import('../../explorer-http')
const http = await import('../edit-workspace-http')

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const POST_HEADERS = { 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'csrf-1' }

describe('edit-workspace HTTP calls', () => {
  it('reads the status with a GET', async () => {
    const fetchMock = stubFetch(200, { workspace: { id: 'w1' } })
    await expect(http.fetchEditWorkspaceStatus('w1')).resolves.toEqual({ workspace: { id: 'w1' } })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/explorer/edit-workspaces/w1')
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('posts the create-PR input with the CSRF headers', async () => {
    const fetchMock = stubFetch(201, { mode: 'direct', url: 'u', number: 1, created: true })
    const input = { mode: 'direct' as const, title: 't', body: 'b', draft: false }
    await http.createEditWorkspacePr('w1', input)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/explorer/edit-workspaces/w1/pr')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual(POST_HEADERS)
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })

  it('posts merge with an empty body', async () => {
    const fetchMock = stubFetch(200, { merged: true })
    await expect(http.mergeEditWorkspace('w1')).resolves.toEqual({ merged: true })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/explorer/edit-workspaces/w1/merge')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual(POST_HEADERS)
    expect(JSON.parse(String(init?.body))).toEqual({})
  })

  it('posts discard with closePr', async () => {
    const fetchMock = stubFetch(200, { removed: true, prClosed: true })
    await http.discardEditWorkspace('w1', true)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/explorer/edit-workspaces/w1/discard')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual(POST_HEADERS)
    expect(JSON.parse(String(init?.body))).toEqual({ closePr: true })
  })

  it('throws ExplorerHttpError with the server code and message on a 409', async () => {
    stubFetch(409, { error: 'Conflicts with the base branch', code: 'NOT_MERGEABLE' })
    const error = await http.mergeEditWorkspace('w1').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExplorerHttpError)
    expect(error).toMatchObject({ status: 409, code: 'NOT_MERGEABLE', message: 'Conflicts with the base branch' })
  })
})

describe('workspaceIdOf', () => {
  it('returns the id of a workspace root and null otherwise', () => {
    expect(http.workspaceIdOf('workspace:w1')).toBe('w1')
    expect(http.workspaceIdOf('project:p')).toBeNull()
    expect(http.workspaceIdOf('issue:PAN-1')).toBeNull()
  })
})
