// Listen for UI commands and act on them in the leader tab (PAN-5349 O-D5).
//
// A leader acts at once, whether visible or not. A fallback acts at once only
// when visible. A follower waits FOLLOWER_WAIT_MS and acts only when it is
// visible and no tab has posted `{ handled: id }` on the broadcast channel,
// which covers a leader that crashed without `pagehide`. Two tabs acting on
// one command is harmless: each opens the same pane in its own deck state.

import { useEffect, useRef } from 'react'
import type { Stream } from 'effect'
import { WS_METHODS, type UiCommand } from '@overdeck/contracts'
import type { DeckNavigation } from '../../components/frame/deck/deckNavigation'
import { getTransport, type PanRpcProtocolClient } from '../wsTransport'
import { installLeaderTracking, leaderRole } from './leaderTab'
import { openPathInDeck } from './openPathInDeck'

export const UI_COMMANDS_CHANNEL = 'overdeck.ui-commands'
export const FOLLOWER_WAIT_MS = 750

export function useUiCommands(navigation: Pick<DeckNavigation, 'openInDeck'>): void {
  const navigationRef = useRef(navigation)
  navigationRef.current = navigation

  useEffect(() => {
    const stopTracking = installLeaderTracking()
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(UI_COMMANDS_CHANNEL) : null
    const handled = new Set<string>()
    const timers = new Set<number>()
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        const id = (event.data as { handled?: unknown } | null)?.handled
        if (typeof id === 'string') handled.add(id)
      }
    }

    const act = (command: UiCommand) => {
      handled.add(command.id)
      try {
        openPathInDeck(command.resolution, navigationRef.current)
      } catch (error) {
        console.warn('[ui-commands] open-path failed', error)
        return
      }
      channel?.postMessage({ handled: command.id })
      window.focus()
      window.overdeckBridge?.raiseWindow?.()
    }

    const onCommand = (command: UiCommand) => {
      if (command.type !== 'open-path' || handled.has(command.id)) return
      const role = leaderRole()
      if (role === 'leader') return act(command)
      if (role === 'fallback') {
        if (document.visibilityState === 'visible') act(command)
        return
      }
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        if (!handled.has(command.id) && document.visibilityState === 'visible') act(command)
      }, FOLLOWER_WAIT_MS)
      timers.add(timer)
    }

    const unsubscribe = getTransport().subscribe(
      (client) =>
        (client as PanRpcProtocolClient)[WS_METHODS.subscribeUiCommands]({}) as unknown as Stream.Stream<UiCommand, Error, never>,
      (command) => onCommand(command as UiCommand),
    )

    return () => {
      unsubscribe()
      stopTracking()
      for (const timer of timers) window.clearTimeout(timer)
      channel?.close()
    }
  }, [])
}
