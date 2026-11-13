import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PanRpcError, WS_METHODS } from '@overdeck/contracts'

const transportMock = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  methods: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('../../../lib/wsTransport', () => ({
  getTransport: () => transportMock,
}))

import {
  explorerDownloadUrl,
  explorerErrorCode,
  gitStage,
  listDir,
  parseRootId,
  rootLabel,
  searchContent,
  searchFiles,
  subscribeWatchStream,
} from '../explorer-rpc'

beforeEach(() => {
  transportMock.methods = {
    [WS_METHODS.explorerListDir]: vi.fn().mockReturnValue({ entries: [], truncated: false, absPath: '/r' }),
    [WS_METHODS.explorerGitStage]: vi.fn().mockReturnValue({}),
    [WS_METHODS.explorerSearchFiles]: vi.fn().mockReturnValue({ paths: [] }),
    [WS_METHODS.explorerSearchContent]: vi.fn().mockReturnValue({ matches: [], truncated: false }),
    [WS_METHODS.explorerWatch]: vi.fn().mockReturnValue('stream'),
  }
  transportMock.request.mockReset()
  transportMock.request.mockImplementation(async (execute: (client: unknown) => unknown) => execute(transportMock.methods))
  transportMock.subscribe.mockReset()
  transportMock.subscribe.mockImplementation((connect: (client: unknown) => unknown) => {
    connect(transportMock.methods)
    return () => {}
  })
})

describe('explorer-rpc unary calls', () => {
  it('listDir sends { rootId, path } to explorerListDir and returns its result', async () => {
    const result = await listDir('issue:PAN-1', 'src')
    expect(transportMock.methods[WS_METHODS.explorerListDir]).toHaveBeenCalledWith({ rootId: 'issue:PAN-1', path: 'src' })
    expect(result).toEqual({ entries: [], truncated: false, absPath: '/r' })
  })

  it('gitStage sends the paths and the action', async () => {
    await gitStage('issue:PAN-1', ['a.ts', 'b.ts'], 'discard')
    expect(transportMock.methods[WS_METHODS.explorerGitStage]).toHaveBeenCalledWith({
      rootId: 'issue:PAN-1',
      paths: ['a.ts', 'b.ts'],
      action: 'discard',
    })
  })

  it('searchFiles defaults the limit to 50', async () => {
    await searchFiles('project:overdeck', 'ws-rpc')
    expect(transportMock.methods[WS_METHODS.explorerSearchFiles]).toHaveBeenCalledWith({
      rootId: 'project:overdeck',
      query: 'ws-rpc',
      limit: 50,
    })
  })

  it('searchContent defaults the limit to 500 and passes the scope', async () => {
    await searchContent({ rootId: 'issue:PAN-1', query: 'foo', scopePath: 'src', regex: false, caseSensitive: true })
    expect(transportMock.methods[WS_METHODS.explorerSearchContent]).toHaveBeenCalledWith({
      rootId: 'issue:PAN-1',
      query: 'foo',
      scopePath: 'src',
      regex: false,
      caseSensitive: true,
      limit: 500,
    })
  })
})

describe('subscribeWatchStream', () => {
  it('subscribes to explorerWatch for the root and passes onReconnect in the options', () => {
    const onBatch = vi.fn()
    const onReconnect = vi.fn()
    const unsubscribe = vi.fn()
    transportMock.subscribe.mockImplementation((connect: (client: unknown) => unknown) => {
      connect(transportMock.methods)
      return unsubscribe
    })
    const stop = subscribeWatchStream('issue:PAN-1', onBatch, onReconnect)
    expect(transportMock.methods[WS_METHODS.explorerWatch]).toHaveBeenCalledWith({ rootId: 'issue:PAN-1' })
    const [, listener, options] = transportMock.subscribe.mock.calls[0]
    expect(listener).toBe(onBatch)
    expect(options).toEqual({ onReconnect })
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('explorerErrorCode', () => {
  it('returns the code of a PanRpcError', () => {
    expect(explorerErrorCode(new PanRpcError({ message: 'gone', code: 'ROOT_NOT_FOUND' }))).toBe('ROOT_NOT_FOUND')
  })

  it('returns undefined for any other error', () => {
    expect(explorerErrorCode(new Error('boom'))).toBeUndefined()
  })
})

describe('root ids', () => {
  it('parseRootId splits on the first colon', () => {
    expect(parseRootId('issue:PAN-1')).toEqual({ kind: 'issue', key: 'PAN-1' })
    expect(parseRootId('workspace:abc:def')).toEqual({ kind: 'workspace', key: 'abc:def' })
  })

  it('parseRootId rejects malformed ids', () => {
    expect(parseRootId('bogus')).toBeNull()
    expect(parseRootId('other:x')).toBeNull()
    expect(parseRootId('project:')).toBeNull()
  })

  it('rootLabel names the project, the issue or the workspace', () => {
    expect(rootLabel('project:overdeck')).toBe('overdeck')
    expect(rootLabel('issue:PAN-1')).toBe('PAN-1')
    expect(rootLabel('workspace:w1')).toBe('workspace w1')
  })
})

describe('explorerDownloadUrl', () => {
  it('encodes both parameters', () => {
    expect(explorerDownloadUrl('issue:PAN-1', 'src/a b&c.ts')).toBe(
      '/api/explorer/download?root=issue%3APAN-1&path=src%2Fa%20b%26c.ts&inline=0',
    )
  })
})
