# Computer-use macOS helper

This Swift package is a port of Orca's macOS computer-use helper
(`stablyai/orca`, MIT, commit `c6b9ac9549b`, path `native/computer-use-macos/`).
Every file is recorded in `scripts/upstream-ports.json` and checked by
`npm run lint:upstream-ports`. Each Swift file starts with two port-header
lines (`// Ported from Orca …` and `// upstream: <path> @ c6b9ac9549b`). In
`Package.swift` the headers sit on lines 2–3, because
`// swift-tools-version: 6.0` must stay on line 1. A file that Overdeck changed
carries a third header line, `// modified for Overdeck: <summary>`. Files
Overdeck wrote from scratch have no port header and no upstream-ports record.

The helper is built as `Overdeck Computer Use.app` so macOS can attach the
Accessibility and Screen Recording grants to its own code identity. It runs as
a daemon (`--agent <socket> --token-file <path>`) that speaks newline-delimited
JSON over a Unix socket. It also has permission modes: `--permissions`,
`--permission <accessibility|screenshots>`, `--permission-status` and
`--permission-status-file <path>`. It needs macOS 14 or later.

## Modifications

Target, module and type names (`OrcaComputerUseMacOS`,
`OrcaComputerUseMacOSCore`, `OrcaComputerUseMacOSTests` and the Swift
identifiers inside them) are unchanged on purpose, to keep upstream diffs small.
Overdeck changes only these:

- `Package.swift`: the executable product is renamed from
  `orca-computer-use-macos` to `overdeck-computer-use-macos`.
- Caller trust (`main.swift` `isAuthorizedAgentPeer`): Orca accepted a peer
  only if its command line named Orca's `computer-sidecar.js` and it or its
  parent was an app with an Orca bundle id. Overdeck instead trusts a peer
  whose uid (`getpeereid`) equals the helper's own uid, through the new
  Overdeck-authored `PeerCredentialTrust.swift` (tested by
  `PeerCredentialTrustTests.swift`). The agent token check is unchanged.
  `TrustedOrcaApplication.swift` and the `ps`-based process lookups are
  deleted.
- Daemon lifetime (`main.swift` `AgentRuntime` and `SocketListener`,
  `AgentSessionOwnership.swift`): Orca's helper exited when its last
  authenticated connection closed and then refused every new connection.
  Overdeck shares one daemon across many short `pan computer` processes, so
  the helper now exits after 600 seconds without a handled request (the timer
  restarts on every request), on `terminate`, or when nothing claims it within
  30 seconds of launch. `AgentSessionOwnership` has no session latch: the first
  authenticated connection is `.claimed` and every later one is `.retained`,
  even after all connections closed (tested by the Overdeck-authored
  `AgentSessionOwnershipTests.swift`).

## Build and test

```bash
npm run build:computer-macos                       # universal .app, signed, zipped into dist/
swift test --package-path native/computer-use-macos
```

Both need macOS with Xcode or the Xcode Command Line Tools. Swift does not
build on the Linux host, so the `computer-use-macos.yml` workflow runs the
tests and the build on a macOS runner.

## Re-vendoring

To move to a newer Orca commit:

1. Run `bash scripts/upstream-port-diff.sh orca` to see what changed upstream
   since the last port.
2. Copy each file again with
   `git -C ~/Projects/orca show <commit>:native/computer-use-macos/<path>`.
3. Keep the port-header lines and bump the commit in both the headers and
   `scripts/upstream-ports.json`.
4. Re-apply every change in the Modifications list above, and keep the
   `// modified for Overdeck:` line on each changed file.
5. Run `npm run lint:upstream-ports`, then let the macOS workflow run
   `swift test` and the build.
