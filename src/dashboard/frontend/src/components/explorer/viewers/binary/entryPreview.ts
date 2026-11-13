// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: packages/shared/src/filePreview.ts @ 2d8a843e6b
/**
 * The three filePreview helpers BinaryViewer uses for archive entries
 * (PAN-5188 §6.10). Archive entries have only a name, so filePreviewKind keeps
 * the name-only (generic MIME) branch of upstream and returns the kinds
 * BinaryViewer distinguishes. decodeFilePreviewText is unchanged.
 *
 * Overdeck change: .svg entries are text, never "image". An SVG shown through a
 * blob: URL runs as a document in the dashboard origin if it is opened in a new
 * tab, which is the active-content risk the download route exists to block.
 */
export type EntryPreviewKind = "image" | "markdown" | "html" | "mermaid" | "text" | "unsupported";

const IMAGE_MIME_TYPE_BY_EXTENSION = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

export function filePreviewKind(file: { readonly name: string }): EntryPreviewKind {
  const name = file.name.toLowerCase();
  const extension = name.slice(name.lastIndexOf("."));
  if (IMAGE_MIME_TYPE_BY_EXTENSION.has(extension)) return "image";
  if (/^\.html?$/.test(extension)) return "html";
  if (/^\.(md|markdown|mdown|mkd|mdx)$/.test(extension)) return "markdown";
  if (/^\.(mmd|mermaid)$/.test(extension)) return "mermaid";
  if (
    /^\.(svg|rtf|txt|log|json|jsonc|jsonl|ndjson|yaml|yml|toml|ini|conf|config|env|csv|tsv|xml|css|scss|sass|less|js|jsx|mjs|cjs|ts|tsx|mts|cts|py|pyi|rb|go|rs|swift|kt|kts|java|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|sql|graphql|gql|vue|svelte|r|lua|ex|exs|erl|hs|clj|dart|diff|patch|lock|properties|gradle)$/.test(
      extension,
    ) ||
    /^(dockerfile|makefile|gemfile|rakefile|license|readme|\.gitignore|\.gitattributes|\.editorconfig|\.env)(\.|$)/i.test(
      name.split(/[\\/]/).at(-1) ?? "",
    )
  )
    return "text";
  return "unsupported";
}

export const FILE_TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

export function decodeFilePreviewText(bytes: Uint8Array, truncated = false) {
  const bounded = bytes.subarray(0, FILE_TEXT_PREVIEW_MAX_BYTES);
  if (bounded.some((byte) => byte === 0))
    throw new Error("This file contains binary data and cannot be shown as text.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return {
      text: decoder.decode(bounded, { stream: truncated || bytes.length > bounded.length }),
      truncated: truncated || bytes.length > bounded.length,
    };
  } catch {
    throw new Error("This file is not UTF-8 text. Open it in another app to view its contents.");
  }
}

/** The MIME type for an image entry's blob: URL; null when the extension is not a previewable image. */
export function hostPreviewMimeTypeFromExtension(extension: string): string | null {
  if (!/^\.[a-z0-9-]+$/i.test(extension)) return null;
  return IMAGE_MIME_TYPE_BY_EXTENSION.get(extension.toLowerCase()) ?? null;
}
