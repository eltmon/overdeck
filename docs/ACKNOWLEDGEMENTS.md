# Acknowledgements

## OpenKnowledge

Overdeck can progressively install and launch [`@inkeep/open-knowledge`](https://github.com/inkeep/open-knowledge), created by [Inkeep](https://inkeep.com/), as the visual viewer for Open Knowledge Format bundles.

OpenKnowledge is licensed [`GPL-3.0-or-later`](https://github.com/inkeep/open-knowledge/blob/main/LICENSE). It is a separate global program and is not distributed inside the MIT-licensed `@overdeck/*` packages. Overdeck invokes its `ok` executable as a subprocess and communicates with it over HTTP and WebSocket; no OpenKnowledge code is imported, linked, or bundled into Overdeck.

## Orca

Overdeck's file explorer ports logic from [Orca](https://github.com/stablyai/orca), licensed MIT, Copyright (c) 2026 Lovecast Inc. The license text ships at `licenses/orca-LICENSE`.

The ported logic covers the file-explorer server: the disk signature that detects files changed on disk, the watch-event batching window and coalescing, and the watcher ignore options. Each ported file starts with a header naming Orca, its upstream path and the commit it was ported from, and `scripts/upstream-ports.json` lists the exact files. `scripts/upstream-port-diff.sh` lists the upstream commits that changed each ported file since its port.

## t3code

Overdeck's file explorer ports logic from [t3code](https://github.com/pingdotgg/t3code), licensed MIT, Copyright (c) 2026 T3 Tools Inc. The license text ships at `licenses/t3code-LICENSE`.

The ported logic covers the file explorer's git-folder guard, which keeps explorer writes out of `.git` folders and bare repositories. Each ported file starts with a header naming t3code, its upstream path and the commit it was ported from, and `scripts/upstream-ports.json` lists the exact files. `scripts/upstream-port-diff.sh` lists the upstream commits that changed each ported file since its port.
