// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/pdfDocument.ts @ 2d8a843e6b
import { getDocument, GlobalWorkerOptions, PDFWorker } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import fallbackUrl from "pdfjs-dist/wasm/openjpeg_nowasm_fallback.js?url";

GlobalWorkerOptions.workerSrc = workerUrl;

// "pdfjs-dist-assets" is a vite.config.ts alias for the real pdfjs-dist folder:
// bun links packages from a store, so a node_modules-relative glob matches nothing.
// Each map is keyed by file basename so lookups do not depend on how Vite spells alias keys.
function byBasename(glob: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(glob).map(([key, url]) => [key.slice(key.lastIndexOf("/") + 1), url]));
}
const standardFonts = byBasename(
  import.meta.glob<string>("pdfjs-dist-assets/standard_fonts/*", { query: "?url", import: "default", eager: true }),
);
const cMaps = byBasename(
  import.meta.glob<string>("pdfjs-dist-assets/cmaps/*.bcmap", { query: "?url", import: "default", eager: true }),
);
const wasm = byBasename(
  import.meta.glob<string>("pdfjs-dist-assets/wasm/*.{wasm,js}", { query: "?url", import: "default", eager: true }),
);
export class BinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const assets = kind === "cMapUrl" ? cMaps : kind === "wasmUrl" ? wasm : standardFonts;
    const directory = kind === "cMapUrl" ? "cmaps" : kind === "wasmUrl" ? "wasm" : "standard_fonts";
    const url = assets[filename];
    if (!url) throw new Error(`Unsupported PDF ${directory} asset.`);
    const response = await fetch(url);
    if (!response.ok || response.headers.get("content-type")?.startsWith("text/html"))
      throw new Error(`PDF ${directory} asset unavailable.`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

// Without a shared worker, pdf.js starts a worker and recompiles its 1.3 MB script for every document.
let worker: PDFWorker | undefined;

export function openPdf(bytes: ArrayBuffer) {
  worker ??= new PDFWorker();
  return getDocument({
    worker,
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    useWorkerFetch: false,
    BinaryDataFactory,
    // PDF.js imports JavaScript decoders directly, bypassing BinaryDataFactory.
    wasmUrl: new URL(".", new URL(fallbackUrl, window.location.href)).href,
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
    useWasm: true,
  });
}
