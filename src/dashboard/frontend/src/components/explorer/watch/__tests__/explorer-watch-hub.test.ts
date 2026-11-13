import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExplorerWatchBatch } from '@overdeck/contracts'

const rpc = vi.hoisted(() => ({
  subscribeWatchStream: vi.fn(),
  streams: [] as Array<{ rootId: string; onBatch: (b: ExplorerWatchBatch) => void; onReconnect: () => void; stop: ReturnType<typeof vi.fn> }>,
}))

vi.mock('../../explorer-rpc', () => ({ subscribeWatchStream: rpc.subscribeWatchStream }))

import { subscribeExplorerWatch } from '../explorer-watch-hub'

beforeEach(() => {
  rpc.streams = []
  rpc.subscribeWatchStream.mockReset()
  rpc.subscribeWatchStream.mockImplementation((rootId: string, onBatch: (b: ExplorerWatchBatch) => void, onReconnect: () => void) => {
    const stop = vi.fn()
    rpc.streams.push({ rootId, onBatch, onReconnect, stop })
    return stop
  })
})

describe('subscribeExplorerWatch', () => {
  it('shares one server subscription per root and closes it after the last listener leaves', () => {
    const a = subscribeExplorerWatch('issue:PAN-1', vi.fn())
    const b = subscribeExplorerWatch('issue:PAN-1', vi.fn())
    expect(rpc.subscribeWatchStream).toHaveBeenCalledTimes(1)
    a()
    expect(rpc.streams[0].stop).not.toHaveBeenCalled()
    b()
    expect(rpc.streams[0].stop).toHaveBeenCalledTimes(1)
  })

  it('opens a separate subscription per root', () => {
    const a = subscribeExplorerWatch('issue:PAN-1', vi.fn())
    const b = subscribeExplorerWatch('project:overdeck', vi.fn())
    expect(rpc.subscribeWatchStream).toHaveBeenCalledTimes(2)
    a()
    b()
  })

  it('fans event batches out to every listener', () => {
    const l1 = vi.fn()
    const l2 = vi.fn()
    const s1 = subscribeExplorerWatch('issue:PAN-1', l1)
    const s2 = subscribeExplorerWatch('issue:PAN-1', l2)
    const events = [{ kind: 'create' as const, path: 'src/a.ts' }]
    rpc.streams[0].onBatch({ events })
    expect(l1).toHaveBeenCalledWith({ kind: 'events', events })
    expect(l2).toHaveBeenCalledWith({ kind: 'events', events })
    s1()
    s2()
  })

  it('delivers an overflow batch as resync', () => {
    const listener = vi.fn()
    const stop = subscribeExplorerWatch('issue:PAN-1', listener)
    rpc.streams[0].onBatch({ events: [{ kind: 'update', path: 'a' }, { kind: 'overflow', path: '' }] })
    expect(listener).toHaveBeenCalledWith({ kind: 'resync' })
    stop()
  })

  it('delivers a reconnect as resync', () => {
    const listener = vi.fn()
    const stop = subscribeExplorerWatch('issue:PAN-1', listener)
    rpc.streams[0].onReconnect()
    expect(listener).toHaveBeenCalledWith({ kind: 'resync' })
    stop()
  })

  it('keeps delivering when one listener throws', () => {
    const good = vi.fn()
    const s1 = subscribeExplorerWatch('issue:PAN-1', () => {
      throw new Error('boom')
    })
    const s2 = subscribeExplorerWatch('issue:PAN-1', good)
    rpc.streams[0].onReconnect()
    expect(good).toHaveBeenCalledWith({ kind: 'resync' })
    s1()
    s2()
  })

  it('lets the next listener retry when opening the stream throws', () => {
    rpc.subscribeWatchStream.mockImplementationOnce(() => {
      throw new Error('bad transport')
    })
    expect(() => subscribeExplorerWatch('issue:PAN-1', vi.fn())).toThrow('bad transport')
    const stop = subscribeExplorerWatch('issue:PAN-1', vi.fn())
    expect(rpc.subscribeWatchStream).toHaveBeenCalledTimes(2)
    expect(rpc.streams).toHaveLength(1)
    stop()
  })

  it('opens a new subscription after the old one closed', () => {
    subscribeExplorerWatch('issue:PAN-1', vi.fn())()
    const stop = subscribeExplorerWatch('issue:PAN-1', vi.fn())
    expect(rpc.subscribeWatchStream).toHaveBeenCalledTimes(2)
    stop()
  })
})
