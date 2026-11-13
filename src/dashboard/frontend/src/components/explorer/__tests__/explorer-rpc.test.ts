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
  copyEntry,
  createEntry,
  explorerDownloadUrl,
  explorerErrorCode,
  gitStage,
  listDir,
  parseRootId,
  renameEntry,
  restoreEntry,
  rootLabel,
  searchContent,
  searchFiles,
  subscribeWatchStream,
  trashPath,
} from '../explorer-rpc'

beforeEach(() => {
  transportMock.methods = {
    [WS_METHODS.explorerListDir]: vi.fn().mockReturnValue({ entries: [], truncated: false, absPath: '/r' }),
    [WS_METHODS.explorerGitStage]: vi.fn().mockReturnValue({}),
    [WS_METHODS.explorerSearchFiles]: vi.fn().mockReturnValue({ paths: [] }),
    [WS_METHODS.explorerSearchContent]: vi.fn().mockReturnValue({ matches: [], truncated: false }),
    [WS_METHODS.explorerWatch]: vi.fn().mockReturnValue('stream'),
    [WS_METHODS.explorerCreate]: vi.fn().mockReturnValue({ entry: { name: 'a.ts' } }),
    [WS_METHODS.explorerRename]: vi.fn().mockReturnValue({ entry: { name: 'b.ts' } }),
    [WS_METHODS.explorerCopy]: vi.fn().mockReturnValue({ entry: { name: 'a copy.ts' } }),
    [WS_METHODS.explorerDelete]: vi.fn().mockReturnValue({ trashIds: ['t1'] }),
    [WS_METHODS.explorerRestore]: vi.fn().mockReturnValue({ path: 'a.ts' }),
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

describe('explorer-rpc write wrappers', () => {
  it('createEntry sends { rootId, path, kind } to explorerCreate', async () => {
    const result = await createEntry('issue:PAN-1', 'src/a.ts', 'file')
    expect(transportMock.methods[WS_METHODS.explorerCreate]).toHaveBeenCalledWith({ rootId: 'issue:PAN-1', path: 'src/a.ts', kind: 'file' })
    expect(result).toEqual({ entry: { name: 'a.ts' } })
  })

  it('renameEntry sends { rootId, from, to } to explorerRename', async () => {
    await renameEntry('issue:PAN-1', 'a.ts', 'b.ts')
    expect(transportMock.methods[WS_METHODS.explorerRename]).toHaveBeenCalledWith({ rootId: 'issue:PAN-1', from: 'a.ts', to: 'b.ts' })
  })

  it('copyEntry sends { rootId, from, to } to explorerCopy', async () => {
    await copyEntry('workspace:w1', 'a.ts', 'a copy.ts')
    expect(transportMock.methods[WS_METHODS.explorerCopy]).toHaveBeenCalledWith({ rootId: 'workspace:w1', from: 'a.ts', to: 'a copy.ts' })
  })

  it('restoreEntry sends { rootId, trashId } to explorerRestore and returns the path', async () => {
    const result = await restoreEntry('issue:PAN-1', 't1')
    expect(transportMock.methods[WS_METHODS.explorerRestore]).toHaveBeenCalledWith({ rootId: 'issue:PAN-1', trashId: 't1' })
    expect(result).toEqual({ path: 'a.ts' })
  })

  it('trashPath sends one path to explorerDelete and returns its trash id', async () => {
    const id = await trashPath('issue:PAN-1', 'a')
    expect(transportMock.methods[WS_METHODS.explorerDelete]).toHaveBeenCalledWith({ rootId: 'issue:PAN-1', paths: ['a'] })
    expect(id).toBe('t1')
  })

  it('trashPath rejects when the server returns no trash id', async () => {
    transportMock.methods[WS_METHODS.explorerDelete] = vi.fn().mockReturnValue({ trashIds: [] })
    await expect(trashPath('issue:PAN-1', 'a')).rejects.toThrow('no trash id for a')
  })
})
