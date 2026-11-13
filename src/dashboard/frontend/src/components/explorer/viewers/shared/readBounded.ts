// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/readBoundedDocument.ts, apps/web/src/components/files/readBinaryPreview.ts @ 2d8a843e6b
/**
 * Fetch a file into memory with a byte cap, failing as soon as the body passes
 * it. readBinaryPreview's limit was the archive cap; here it is a parameter.
 */
export const BINARY_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;

async function readCapped(response: Response, limit: number, tooLarge: string, unavailable: string) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(unavailable);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error(tooLarge);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Blob(chunks as BlobPart[]).arrayBuffer();
}

export async function readBounded(
  src: string,
  signal: AbortSignal,
  limit: number,
  cache: RequestCache = 'default',
): Promise<ArrayBuffer> {
  const response = await fetch(src, { signal, cache });
  if (!response.ok || Number(response.headers.get('content-length')) > limit)
    throw new Error('This file is unavailable or too large to preview.');
  return readCapped(response, limit, 'This file is too large to preview.', 'This file is unavailable.');
}

export async function readBinaryPreview(
  src: string,
  signal: AbortSignal,
  limit: number = BINARY_PREVIEW_MAX_BYTES,
): Promise<ArrayBuffer> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error('The file could not be loaded. Close it and try again.');
  const tooLarge = `Preview limited to files under ${Math.round(limit / (1024 * 1024))} MB.`;
  if (Number(response.headers.get('content-length')) > limit) throw new Error(tooLarge);
  return readCapped(response, limit, tooLarge, 'The file is unavailable.');
}
