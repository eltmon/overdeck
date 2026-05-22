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
import { PanRpcGroup, WS_METHODS, type FlywheelStatus } from '@panctl/contracts'

// ─── Protocol setup ───────────────────────────────────────────────────────────

export const makePanRpcClient = RpcClient.make(PanRpcGroup)

type RpcClientFactory = typeof makePanRpcClient
export type PanRpcProtocolClient = RpcClientFactory extends Effect.Effect<infer C, any, any>
  ? C
  : never

function resolveRpcUrl(url?: string): string {
  if (url) return url
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  // Use VITE_API_URL when available — frontend and API are on different subdomains
  // (e.g. feature-pan-428.pan.localhost vs api-feature-pan-428.pan.localhost)
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl) {
    const apiHost = new URL(apiUrl).host
    return `${proto}://${apiHost}/ws/rpc`
  }
  return `${proto}://${window.location.host}/ws/rpc`
}

function dashboardSessionUrl(url?: string): string {
  const rpcUrl = new URL(resolveRpcUrl(url))
  rpcUrl.protocol = rpcUrl.protocol === 'wss:' ? 'https:' : 'http:'
  rpcUrl.pathname = '/api/dashboard/session'
  rpcUrl.search = ''
  rpcUrl.hash = ''
  return rpcUrl.toString()
}

let dashboardSessionPromise: Promise<void> | null = null
let dashboardCsrfToken: string | null = null

function consumeDashboardBootstrapToken(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const token = params.get('panopticon_token') ?? params.get('token')
  if (!token) return null
  params.delete('panopticon_token')
  params.delete('token')
  const nextHash = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`)
  return token
}

export function ensureDashboardSession(url?: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const token = consumeDashboardBootstrapToken()
  dashboardSessionPromise ??= fetch(dashboardSessionUrl(url), {
    method: 'POST',
    credentials: 'include',
    headers: token ? { 'x-panopticon-internal-token': token } : undefined,
  }).then(async (response) => {
    if (response.status === 401) return
    if (!response.ok) throw new Error(`Dashboard session bootstrap failed: HTTP ${response.status}`)
    const data = await response.json().catch(() => null) as { csrfToken?: unknown } | null
    if (typeof data?.csrfToken === 'string') dashboardCsrfToken = data.csrfToken
  }).catch((err) => {
    dashboardSessionPromise = null
    throw err
  })
  return dashboardSessionPromise
}

export async function dashboardMutationJsonHeaders(url?: string): Promise<Record<string, string>> {
  await ensureDashboardSession(url)
  if (!dashboardCsrfToken) throw new Error('Dashboard CSRF token unavailable')
  return {
    'Content-Type': 'application/json',
    'x-panopticon-csrf-token': dashboardCsrfToken,
  }
}

function createPanRpcProtocolLayer(url?: string) {
  const resolvedUrl = resolveRpcUrl(url)

  const socketLayer = Socket.layerWebSocket(resolvedUrl).pipe(
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
  )

  return RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)),
  )
}

// ─── WsTransport ─────────────────────────────────────────────────────────────

export interface SubscribeOptions {
  readonly retryDelay?: Duration.Input
  /** Called when the subscription reconnects after a failure. Use this to
   *  re-bootstrap state (e.g. re-fetch the snapshot from the new server). */
  readonly onReconnect?: () => void
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
    this.clientPromise = ensureDashboardSession(url).then(() =>
      this.runtime.runPromise(
        Scope.provide(this.clientScope)(makePanRpcClient),
      ),
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
    const onReconnect = options?.onReconnect
    let hasConnectedOnce = false

    const run = () => {
      if (!active) return
      const transport = getTransport()

      currentCancel = transport.runtime.runCallback(
        Effect.promise(() => transport.clientPromise).pipe(
          Effect.flatMap((client) =>
            Stream.runForEach(connect(client), (value) =>
              Effect.sync(() => {
                if (!active) return
                // Fire onReconnect the first time we receive data after a
                // reconnection. This lets EventRouter re-bootstrap its
                // snapshot from the new server instance.
                if (hasConnectedOnce && onReconnect) {
                  hasConnectedOnce = false // reset so it only fires once per reconnect
                  try { onReconnect() } catch { /* non-fatal */ }
                }
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
                hasConnectedOnce = true // mark that next successful data = reconnect
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
              hasConnectedOnce = true
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

export function subscribeFlywheelStatus(
  listener: (status: FlywheelStatus | null) => void,
  options?: SubscribeOptions,
): () => void {
  return getTransport().subscribe(
    (client) =>
      (client as PanRpcProtocolClient)[WS_METHODS.subscribeFlywheelStatus]({}) as unknown as Stream.Stream<FlywheelStatus | null, Error>,
    listener,
    options,
  )
}

export function resetTransport(): void {
  if (_transport) {
    _transport.dispose()
    _transport = null
  }
}
