/**
 * WsTransport — Effect-based WebSocket RPC client for the Panopticon dashboard (PAN-428 B4)
 *
 * Connects to /ws/rpc using the PanRpcGroup contract.
 * Provides request (unary), requestStream (stream to completion), and
 * subscribe (persistent stream with auto-reconnect) operations.
 *
 * Modeled on T3Code's WsTransport pattern.
 */

import { Duration, Effect, Exit, Layer, ManagedRuntime, Schedule, Scope, Stream } from 'effect'
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc'
import * as Socket from 'effect/unstable/socket/Socket'
import { PanRpcGroup } from '@panopticon/contracts'

// ─── Protocol setup ───────────────────────────────────────────────────────────

export const makePanRpcClient = RpcClient.make(PanRpcGroup)

type RpcClientFactory = typeof makePanRpcClient
export type PanRpcProtocolClient = RpcClientFactory extends Effect.Effect<infer C, any, any>
  ? C
  : never

function createPanRpcProtocolLayer(url?: string) {
  const resolvedUrl =
    url ??
    (() => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      // Use VITE_API_URL when available — frontend and API are on different subdomains
      // (e.g. feature-pan-428.pan.localhost vs api-feature-pan-428.pan.localhost)
      const apiUrl = import.meta.env.VITE_API_URL
      if (apiUrl) {
        const apiHost = new URL(apiUrl).host
        return `${proto}://${apiHost}/ws/rpc`
      }
      return `${proto}://${window.location.host}/ws/rpc`
    })()

  const socketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  )

  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)),
  )
}

// ─── WsTransport ─────────────────────────────────────────────────────────────

interface SubscribeOptions {
  readonly retryDelay?: Duration.Input
}

const DEFAULT_RETRY_DELAY = Duration.millis(250)

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return String(error)
}

export class WsTransport {
  private readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>
  private readonly clientScope: Scope.Closeable
  private readonly clientPromise: Promise<PanRpcProtocolClient>
  private disposed = false

  constructor(url?: string) {
    this.runtime = ManagedRuntime.make(createPanRpcProtocolLayer(url))
    this.clientScope = this.runtime.runSync(Scope.make())
    this.clientPromise = this.runtime.runPromise(
      Scope.provide(this.clientScope)(makePanRpcClient),
    )
  }

  /** One-off unary RPC call */
  async request<TSuccess>(
    execute: (client: PanRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
  ): Promise<TSuccess> {
    if (this.disposed) throw new Error('WsTransport disposed')
    const client = await this.clientPromise
    return this.runtime.runPromise(Effect.suspend(() => execute(client)))
  }

  /** Stream to completion (one-shot) */
  async requestStream<TValue>(
    connect: (client: PanRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
  ): Promise<void> {
    if (this.disposed) throw new Error('WsTransport disposed')
    const client = await this.clientPromise
    await this.runtime.runPromise(
      Stream.runForEach(connect(client), (value) =>
        Effect.sync(() => {
          try {
            listener(value)
          } catch {
            // Swallow listener errors — keep stream alive
          }
        }),
      ),
    )
  }

  /** Persistent subscription with automatic reconnection */
  subscribe<TValue>(
    connect: (client: PanRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: SubscribeOptions,
  ): () => void {
    if (this.disposed) return () => undefined

    let active = true
    let currentCancel: (() => void) | null = null
    const retryDelay = options?.retryDelay ?? DEFAULT_RETRY_DELAY

    const run = () => {
      if (!active) return
      const transport = getTransport()

      currentCancel = transport.runtime.runCallback(
        Effect.promise(() => transport.clientPromise).pipe(
          Effect.flatMap((client) =>
            Stream.runForEach(connect(client), (value) =>
              Effect.sync(() => {
                if (!active) return
                try {
                  listener(value)
                } catch {
                  // Swallow listener errors
                }
              }),
            ),
          ),
          Effect.catchDefect((defect: unknown) =>
            Effect.fail(new Error(formatError(defect))),
          ),
          Effect.tapError((err) =>
            Effect.sync(() => {
              if (active) {
                console.warn('[WsTransport] subscription error, retrying:', formatError(err))
              }
            }),
          ),
          Effect.retry(Schedule.fixed(retryDelay)),
          Effect.forever,
        ),
        {
          onExit: (exit) => {
            if (active && Exit.isFailure(exit)) {
              console.warn('[WsTransport] subscription exited, reconnecting with fresh transport')
              resetTransport()
              setTimeout(run, 1000)
            }
          },
        },
      )
    }

    run()

    return () => {
      active = false
      currentCancel?.()
    }
  }

  dispose(): void {
    this.disposed = true
    this.runtime.runSync(Scope.close(this.clientScope, Exit.void))
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _transport: WsTransport | null = null

export function getTransport(): WsTransport {
  if (!_transport) {
    _transport = new WsTransport()
  }
  return _transport
}

export function resetTransport(): void {
  if (_transport) {
    _transport.dispose()
    _transport = null
  }
}
