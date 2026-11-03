# @overdeck/anywhere-channel

One secure-channel protocol for both ends of an Overdeck Anywhere link: the machine (the
dashboard server, on Node) and the phone app (a browser WebView). The preamble, the Noise
handshakes, the refusals and the initiator sequence exist once, here, so the two sides cannot
drift apart (pan-4823 D-7). Private workspace package, MIT, source exports, no build step. The
server bundles inline it through the workspace symlink (tsdown `alwaysBundle: /^@overdeck\//`).

## Entry points

| Import | Runs on | Exports |
| --- | --- | --- |
| `@overdeck/anywhere-channel` | anywhere | The protocol core: `noise.ts` (`pairingSecrets`, `prologueFor`, `approvalNonce`, `approvalCommitment`, `approvalSas`, the IK/XX/XXpsk0 constructors, `StaticKeyPair`, `generateStaticKeyPair`), `wire.ts` (preamble, frames, refusals, `FrameReader`, `RawDuplex`), `initiator.ts` (`runInitiatorHandshake`, `withDeadline`, `ChannelOpenError`, `ChannelMarker`), and `type CryptoPort`. |
| `@overdeck/anywhere-channel/node` | Node | The core plus `nodeCrypto` (`node:crypto`). The server imports this. |
| `@overdeck/anywhere-channel/web` | browser | The core plus `webCrypto`, `openSecureChannel`, `RtcDuplexWeb` (and `RTC_MAX_MESSAGE_BYTES`, `RTC_HIGH_WATER_BYTES`, `RTC_LOW_WATER_BYTES`), `DirectoryWebClient`, `createMachineDialer`; HTTP over a channel (`serializeRequest`, `ResponseParser`, `HttpParseError`, `CHANNEL_HOST`, `MAX_RESPONSE_BODY_BYTES`, `requestOnChannel`, `createChannelPool`, `ChannelHttpError`, `CHANNEL_POOL_MAX`, `CHANNEL_POOL_IDLE_MS`); `ChannelWebSocket` with `ChannelMessageEvent` and `ChannelCloseEvent`; and the page shims (`installChannelShims`, `channelPathFor`). No file under `src/` (the server) imports it. |

Nothing outside `crypto-node.ts`, `node.ts` and `__tests__/` imports `node:*`, calls `require(`
or names the global `Buffer`. Signatures use `Uint8Array`; the code uses `b4a` at runtime, which
returns `Buffer`s on Node and `Uint8Array`s in a browser.

## The crypto port

```ts
interface CryptoPort {
  sha256(data: Uint8Array): Uint8Array;
  randomBytes(n: number): Uint8Array;
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}
```

`nodeCrypto` wraps `node:crypto`. `webCrypto` uses `@noble/hashes/sha2.js`,
`crypto.getRandomValues` (in chunks of at most 64 KiB) and a constant-time compare. Every
function that hashes or draws randomness takes the port as its first argument, for example
`pairingSecrets(crypto, code)`. There is no module-global "current port", so one process can run
both (the cross-port test does). Golden vectors pin the bytes for both ports.

## The initiator seam

`runInitiatorHandshake(raw, label, opts, crypto, track, finish)` writes the preamble, runs the
Noise messages, maps refusals to `ChannelOpenError` codes and runs approval commit-then-reveal.
`withDeadline` adds the timeout (default 10 s) and abort handling. `finish` is called
**synchronously, in the same tick as the last handshake frame**: after the reader detaches and
the final message is written, with the bytes that arrived behind that frame as `leftover`. It
must build the secret stream right there. Building it in an `await` continuation loses bytes the
peer sent right after its last handshake message. The server's `openChannel` and the phone's
`openSecureChannel` both call this one sequence.

## Browser bundling

A browser build needs:

- `events` aliased to `bare-events` (`streamx` imports `events`; Vite does not polyfill it);
- `sodium-native` aliased to `sodium-javascript` (pure-JS libsodium; `sodium-universal`'s
  `browser` field implies it, but make it explicit);
- `@noble/hashes` imported as `@noble/hashes/sha2.js` (the package is ESM-only).

Alias to absolute paths resolved from this package: with bun's isolated layout,
`sodium-universal` cannot see this package's dependencies by bare name. `cp1/vite.config.ts` is
a working example.

## Machine dialer

`createMachineDialer(directory).dialMachine(environmentId, { relay })` opens an ordered `ovdl`
data channel to a machine through the directory's `signal` frames and resolves with an
`RtcDuplexWeb`. A machine closes its older peer connection when a new offer arrives for the same
peer, so the dialer keeps **one peer connection per (machine, relay)** and opens one more data
channel on it per dial. It replaces a connection that is `failed`, `closed` or `disconnected`,
and a dial times out after 15 s.

## HTTP and WebSocket over the channel (PAN-4834)

Inside a channel a machine speaks plain HTTP/1.1: its channel listener hands the channel to the
dashboard's Node HTTP server as if it were a TCP socket. A WebView cannot point `fetch` or
`WebSocket` at a byte stream, so the phone writes the protocol itself.

- **One channel is one HTTP/1.1 connection**, with one request in flight at a time.
  `serializeRequest` always sends `Host: link.invalid`, `Connection: keep-alive` and
  `Accept-Encoding: identity`, so the response is never compressed. It drops the caller's
  `Origin`, `Cookie`, `Host` and framing headers. A phone credential skips the server's Origin
  and CSRF checks, so the phone sends no `Origin` at all.
- **`ResponseParser`** is incremental: bytes can arrive one at a time. It reads
  `Content-Length`, `chunked` and read-to-close bodies, and no body for `HEAD`, 204 and 304. It
  discards interim `1xx` heads and completes a 101 at the end of its head. Bytes behind a
  response come back as `leftover`, never dropped: the first WebSocket frame can ride behind the
  101. Heads are capped at 64 KiB and bodies at 32 MiB.
- **`createChannelPool({ dial })`** is the phone's `LinkAgent`. It keeps at most 4 channels per
  machine and queues further requests in FIFO order. An idle channel closes after 4 s, because
  the machine's HTTP server closes an idle connection after 5 s. A `Keep-Alive: timeout=N` hint
  lowers that to `N*1000 - 1000` ms when the result is positive and smaller. A `GET`, `HEAD` or
  `OPTIONS` that fails on a reused channel before any response byte is resent once on a fresh
  channel, after the pool drops every idle channel (the PAN-4740 rule). An aborted request
  destroys its channel and frees its slot. `close()` rejects queued, in-flight and later
  requests with `pool-closed`.
- **`ChannelWebSocket`** has the browser `WebSocket` interface. Each socket dials its own
  channel, because the upgrade consumes the HTTP connection. It checks the 101, `Upgrade`,
  `Connection`, `Sec-WebSocket-Accept` (SHA-1 from `@noble/hashes/legacy.js`), the chosen
  subprotocol, and the absence of extensions. A server close code such as 4401 reaches the
  `close` event with `wasClean: true`. Every abnormal end fires `error` and then `close` 1006,
  and `close` fires exactly once. `binaryType` defaults to `'blob'`; `'arraybuffer'` works too.
  Messages are capped at 32 MiB.
- **Not supported, by design:** sending a `Blob` over a channel WebSocket throws a `TypeError`;
  `bufferedAmount` is always 0; `extensions` is always `''` and none are offered; redirects come
  back as 3xx responses and are never followed; there is no request timeout beyond the caller's
  `AbortSignal`; response bodies are buffered, not streamed.

## Page shims

`installChannelShims({ currentMachine })` replaces `globalThis.fetch` and
`globalThis.WebSocket` and returns `uninstall`, which restores both and closes every pool.
`currentMachine()` returns `{ environmentId, bearerToken, dial }` or `null`. It is read on every
request, so switching machines needs no reinstall. Each machine keeps its own pool, and a pool
refuses to dial after its machine stops being the current one.

A URL is routed through the channel when its path starts with `/api/` or `/ws/` and it is
relative, or has the page's protocol and host. A WebSocket URL may also use `ws:` or `wss:` on
the page's host. `channelPathFor` holds the rule. It compares `protocol` and `host` and never
`origin`, because `new URL('capacitor://localhost/x').origin` is `"null"`. A routed request
carries `Authorization: Bearer <phone token>` and becomes a real `Response`. Every other URL,
such as the directory at `wss://connect.overdeck.ai`, reaches the original `fetch` or
`WebSocket` unchanged, so the phone token never leaves the channel. A channel failure rejects
with `TypeError('Failed to fetch')`, as a browser network failure does. With no machine
selected the `cause` is `No machine is selected`.

## CP-2: direct URL loads

An element that loads its own URL, such as `<img src>`, `<a href>` or `EventSource`, bypasses
`fetch` and therefore the shims. The audit, run from `src/dashboard/frontend/src`:

```bash
grep -rn --include=*.tsx --include=*.ts -E "src=\{?[\"'\`]/api|href=\{?[\"'\`]/api|url\(/api|new EventSource|EventSource\(|\.body\.getReader|\.body\?\.getReader|navigator\.sendBeacon|new Image\(" . | grep -v __tests__
grep -n -E "<img|<video|<audio|src=|href=" components/chat/**/*.tsx components/mobile/*.tsx
```

- **Reachable on the phone, fixed:** the chat attachment thumbnail
  (`components/chat/messagesTimeline/messageRows.tsx`) and the image lightbox
  (`components/chat/ImageLightbox.tsx`). Both load through `useChannelMediaSrc`
  (`lib/useChannelMediaSrc.ts`). In the native shell (`isNativeShell()`, `lib/nativeShell.ts`)
  it fetches the `/api/…` image into an object URL; elsewhere it returns the URL unchanged.
- **Desktop-only, not supported in the app:** GodView's files link
  (`components/GodView/ActionBar.tsx`) and the streaming readers in `DeepWipeDialog.tsx`,
  `PlanDialog.tsx` and `hooks/useResetIssue.ts`. No phone screen mounts them.
- **Not machine URLs:** composer previews (object URLs), the QR image, sharing avatars, external
  links, tracker URLs and the pairing camera.
- There is no `EventSource`, `sendBeacon` or CSS `url(/api…)` in the frontend.

## CP-1

[CP-1.md](./CP-1.md) records pure-JS libsodium in browser engines: pairing handshake and 1 MiB
took 82 ms / 200 ms in Chromium at 4x CPU throttle, 31 ms / 44 ms in WebKit, and
155 ms / 234 ms in Chrome on the Android emulator, against a 2 s bar. Re-run the browser legs
with `VITEST_INCLUDE_SLOW=1 npx vitest run tests/integration/anywhere/cp1-browsers.slow.test.ts`.
