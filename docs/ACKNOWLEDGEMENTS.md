# Acknowledgements

## OpenKnowledge

Overdeck can progressively install and launch [`@inkeep/open-knowledge`](https://github.com/inkeep/open-knowledge), created by [Inkeep](https://inkeep.com/), as the visual viewer for Open Knowledge Format bundles.

OpenKnowledge is licensed [`GPL-3.0-or-later`](https://github.com/inkeep/open-knowledge/blob/main/LICENSE). It is a separate global program and is not distributed inside the MIT-licensed `@overdeck/*` packages. Overdeck invokes its `ok` executable as a subprocess and communicates with it over HTTP and WebSocket; no OpenKnowledge code is imported, linked, or bundled into Overdeck.
