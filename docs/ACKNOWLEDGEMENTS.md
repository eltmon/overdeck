# Acknowledgements

## OpenKnowledge

Overdeck can progressively install and launch [`@inkeep/open-knowledge`](https://github.com/inkeep/open-knowledge), created by [Inkeep](https://inkeep.com/), as the visual viewer for Open Knowledge Format bundles.

OpenKnowledge is licensed [`GPL-3.0-or-later`](https://github.com/inkeep/open-knowledge/blob/main/LICENSE). It is a separate global program and is not distributed inside the MIT-licensed `@overdeck/*` packages. Overdeck invokes its `ok` executable as a subprocess and communicates with it over HTTP and WebSocket; no OpenKnowledge code is imported, linked, or bundled into Overdeck.

## Orca

Overdeck's file explorer ports logic from [Orca](https://github.com/stablyai/orca), licensed MIT, Copyright (c) 2026 Lovecast Inc. The license text ships at `licenses/orca-LICENSE`.

The ported logic covers the file-explorer server: the disk signature that detects files changed on disk, the watch-event batching window and coalescing, and the watcher ignore options. Each ported file starts with a header naming Orca, its upstream path and the commit it was ported from, and `scripts/upstream-ports.json` lists the exact files. `scripts/upstream-port-diff.sh` lists the upstream commits that changed each ported file since its port.

## t3code

Overdeck's file explorer ports logic from [t3code](https://github.com/pingdotgg/t3code), licensed MIT, Copyright (c) 2026 T3 Tools Inc. The license text ships at `licenses/t3code-LICENSE`.

The ported logic covers the file explorer's git-folder guard, which keeps explorer writes out of `.git` folders and bare repositories, and the file viewers under `src/dashboard/frontend/src/components/explorer/viewers/` (PAN-5188): the pdf.js PDF viewer (`PdfViewer`, `pdfDocument`, `pdfLayout`, `pdfViewer.css`), the large-text and delimited table viewers (`LargeTextViewer`, `VirtualTablePreview`, `DelimitedTablePreview`, `largeText.worker`, `largeTextProtocol`, `delimitedPreview`), the font viewer, the TIFF decoder (`imageDecode.worker`, `decodeImagePreview`), the archive and SQLite viewer (`BinaryViewer`, `binaryPreview.worker`, `binaryPreviewProtocol`, `boundedZip`, `zipDirectory`, `entryPreview`), the viewer router's extension table, and the shared `readBounded`, `observeResize` and `formatSize` helpers. Each ported file starts with a header naming t3code, its upstream path and the commit it was ported from, and `scripts/upstream-ports.json` lists the exact files. `scripts/upstream-port-diff.sh` lists the upstream commits that changed each ported file since its port.

### Viewer packages

The file viewers bundle these third-party packages, each loaded only when its viewer renders:

- [`pdfjs-dist`](https://github.com/mozilla/pdf.js) (Apache-2.0), the PDF renderer.
- [`sql.js`](https://github.com/sql-js/sql.js) (MIT), SQLite compiled to WebAssembly.
- [`tiff`](https://github.com/image-js/tiff) (MIT), the TIFF decoder.
- [`jszip`](https://github.com/Stuk/jszip), dual-licensed `MIT OR GPL-3.0-or-later`; Overdeck uses it under the MIT option.

`heic-to` is not bundled, because it is licensed LGPL-3.0, so the image viewer has no HEIC/HEIF decoder.
