# @overdeck/anywhere-channel

One secure-channel protocol for both ends of an Overdeck Anywhere link: the machine (the
dashboard server, on Node) and the phone app (a browser WebView). The preamble, the Noise
handshakes, the refusals and the initiator sequence exist once, here, so the two sides cannot
drift apart (pan-4823 D-7). Private workspace package, MIT, source exports, no build step. The
server bundles inline it through the workspace symlink (tsdown `alwaysBundle: /^@overdeck\//`).

## Entry points

| Import | Runs on | Exports |
| --- | --- | --- |
| `@overdeck/anywhere-channel` | anywhere | The protocol core: `noise.ts` (`pairingSecrets`, `prologueFor`, `approvalNonce`, `approvalCommitment`, `approvalSas`, the IK/XX/XXpsk0 constructors, `StaticKeyPair`), `wire.ts` (preamble, frames, refusals, `FrameReader`, `RawDuplex`), `initiator.ts` (`runInitiatorHandshake`, `withDeadline`, `ChannelOpenError`, `ChannelMarker`), and `type CryptoPort`. |
| `@overdeck/anywhere-channel/node` | Node | The core plus `nodeCrypto` (`node:crypto`). The server imports this. |
| `@overdeck/anywhere-channel/web` | browser | The core plus `webCrypto`, `openSecureChannel`, `RtcDuplexWeb` (and `RTC_MAX_MESSAGE_BYTES`, `RTC_HIGH_WATER_BYTES`, `RTC_LOW_WATER_BYTES`), `DirectoryWebClient`, `createMachineDialer`. No file under `src/` (the server) imports it. |

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

## CP-1

[CP-1.md](./CP-1.md) records pure-JS libsodium in browser engines: pairing handshake and 1 MiB
took 82 ms / 200 ms in Chromium at 4x CPU throttle, 31 ms / 44 ms in WebKit, and
155 ms / 234 ms in Chrome on the Android emulator, against a 2 s bar. Re-run the browser legs
with `VITEST_INCLUDE_SLOW=1 npx vitest run tests/integration/anywhere/cp1-browsers.slow.test.ts`.
