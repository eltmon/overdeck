// Shared explorer watch subscriptions (PAN-5186, WI-B8; FR-21, D-B5).
//
// One pan.explorerWatch server subscription per root, ref-counted across every
// local listener: the tree, git status, and later PAN-5187's code panes. The
// first listener opens the stream; the last one to leave closes it. A batch
// with an `overflow` event, and every stream reconnect, reach listeners as
// `resync`: the listener re-lists everything it shows (FR-20).

import type { ExplorerWatchEvent } from '@overdeck/contracts'

import { subscribeWatchStream } from '../explorer-rpc'

export type WatchSignal = { kind: 'events'; events: readonly ExplorerWatchEvent[] } | { kind: 'resync' }
export type WatchListener = (signal: WatchSignal) => void

interface Channel {
  listeners: Set<WatchListener>
  unsubscribe: () => void
}

const channels = new Map<string, Channel>()

function deliver(rootId: string, signal: WatchSignal): void {
  const channel = channels.get(rootId)
  if (!channel) return
  for (const listener of [...channel.listeners]) {
    try {
      listener(signal)
    } catch {
      // One broken listener must not starve the others.
    }
  }
}

export function subscribeExplorerWatch(rootId: string, listener: WatchListener): () => void {
  let channel = channels.get(rootId)
  if (!channel) {
    const created: Channel = { listeners: new Set(), unsubscribe: () => {} }
    channels.set(rootId, created)
    channel = created
    created.unsubscribe = subscribeWatchStream(
      rootId,
      (batch) => {
        if (batch.events.some((e) => e.kind === 'overflow')) deliver(rootId, { kind: 'resync' })
        else if (batch.events.length > 0) deliver(rootId, { kind: 'events', events: batch.events })
      },
      () => deliver(rootId, { kind: 'resync' }),
    )
  }
  const owned = channel
  owned.listeners.add(listener)

  let active = true
  return () => {
    if (!active) return
    active = false
    owned.listeners.delete(listener)
    if (owned.listeners.size === 0 && channels.get(rootId) === owned) {
      channels.delete(rootId)
      owned.unsubscribe()
    }
  }
}
