import { open, stat } from 'node:fs/promises';
import { MAX_FALLBACK_BYTES, MAX_READ_BYTES } from './types.js';

// ─── Compact boundary offset cache ───────────────────────────────────────────

/**
 * In-memory cache mapping JSONL file path → last compact_boundary byte offset
 * and the byte offset up to which we've scanned complete lines.
 * Persists across requests so we don't re-scan the entire file each time.
 */
const COMPACT_OFFSET_CACHE_MAX = 100;
const compactOffsetCache = new Map<string, { boundaryOffset: number; scannedUpTo: number }>();

function setCompactOffsetCache(sessionFile: string, value: { boundaryOffset: number; scannedUpTo: number }): void {
  compactOffsetCache.set(sessionFile, value);
  if (compactOffsetCache.size > COMPACT_OFFSET_CACHE_MAX) {
    const firstKey = compactOffsetCache.keys().next().value;
    if (firstKey !== undefined) {
      compactOffsetCache.delete(firstKey);
    }
  }
}

/**
 * Find the byte offset of the last `compact_boundary` system entry in a JSONL file.
 *
 * Uses an in-memory cache keyed by file path. When the file grows beyond
 * the cached scan position, only the new portion is scanned. Returns 0 if no boundary found.
 */
export async function findLastCompactBoundary(sessionFile: string): Promise<number> {
  const fileStats = await stat(sessionFile);
  const fileSize = fileStats.size;

  const cached = compactOffsetCache.get(sessionFile);

  // If file hasn't grown since last scan, return cached offset without reading
  if (cached && cached.scannedUpTo === fileSize) {
    return cached.boundaryOffset;
  }

  // No cache or file shrank — scan entire file in capped chunks
  if (!cached || fileSize < cached.scannedUpTo) {
    let lastBoundaryOffset = 0;
    let scanPos = 0;
    const fh = await open(sessionFile, 'r');
    try {
      while (scanPos < fileSize) {
        const toRead = Math.min(fileSize - scanPos, MAX_READ_BYTES);
        let buf: Buffer;
        let bytesRead: number;
        try {
          buf = Buffer.alloc(toRead);
          const result = await fh.read(buf, 0, toRead, scanPos);
          bytesRead = result.bytesRead;
        } catch {
          break;
        }

        if (bytesRead === 0) break;

        let scanBytes = bytesRead;
        const lastNewline = buf.lastIndexOf('\n', bytesRead - 1);

        if (lastNewline !== -1) {
          scanBytes = lastNewline + 1;
        } else if (scanPos + bytesRead < fileSize) {
          // No newline in chunk and more file remains — read more, capped
          const remaining = Math.min(fileSize - scanPos, MAX_FALLBACK_BYTES);
          const fullBuf = Buffer.alloc(remaining);
          let fullBytesRead: number;
          try {
            const result = await fh.read(fullBuf, 0, remaining, scanPos);
            fullBytesRead = result.bytesRead;
          } catch {
            break;
          }
          const fullLastNewline = fullBuf.lastIndexOf('\n', fullBytesRead - 1);
          if (fullLastNewline !== -1) {
            scanBytes = fullLastNewline + 1;
            buf = fullBuf;
          } else {
            scanBytes = fullBytesRead;
            buf = fullBuf;
          }
        }

        const text = buf.toString('utf-8', 0, scanBytes);
        let bytePos = scanPos;
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const cleanLine = line.replace(/\r$/, '');
              const entry = JSON.parse(cleanLine);
              if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
                lastBoundaryOffset = bytePos;
              }
            } catch { /* skip invalid lines */ }
          }
          bytePos += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
        }

        scanPos += scanBytes;
      }
    } finally {
      await fh.close();
    }

    setCompactOffsetCache(sessionFile, { boundaryOffset: lastBoundaryOffset, scannedUpTo: fileSize });
    return lastBoundaryOffset;
  }

  // File grew — read only the new portion, respecting complete-line boundaries
  const newBytes = fileSize - cached.scannedUpTo;
  const toRead = Math.min(newBytes, MAX_READ_BYTES);
  const fh = await open(sessionFile, 'r');
  try {
    let buf: Buffer;
    let bytesRead: number;
    try {
      buf = Buffer.alloc(toRead);
      const result = await fh.read(buf, 0, toRead, cached.scannedUpTo);
      bytesRead = result.bytesRead;
    } catch {
      setCompactOffsetCache(sessionFile, { boundaryOffset: cached.boundaryOffset, scannedUpTo: fileSize });
      return cached.boundaryOffset;
    }

    let scanBytes = 0;
    if (bytesRead > 0) {
      const lastNewline = buf.lastIndexOf('\n', bytesRead - 1);
      if (lastNewline !== -1) {
        scanBytes = lastNewline + 1;
      } else if (cached.scannedUpTo + bytesRead < fileSize) {
        // No newline in chunk and more file remains — read to EOF, capped
        const remaining = Math.min(fileSize - cached.scannedUpTo, MAX_FALLBACK_BYTES);
        const fullBuf = Buffer.alloc(remaining);
        let fullBytesRead: number;
        try {
          const result = await fh.read(fullBuf, 0, remaining, cached.scannedUpTo);
          fullBytesRead = result.bytesRead;
        } catch {
          setCompactOffsetCache(sessionFile, { boundaryOffset: cached.boundaryOffset, scannedUpTo: fileSize });
          return cached.boundaryOffset;
        }
        const fullLastNewline = fullBuf.lastIndexOf('\n', fullBytesRead - 1);
        if (fullLastNewline !== -1) {
          scanBytes = fullLastNewline + 1;
          buf = fullBuf;
        } else {
          // No newline even at EOF — don't scan partial trailing line
          setCompactOffsetCache(sessionFile, { boundaryOffset: cached.boundaryOffset, scannedUpTo: fileSize });
          return cached.boundaryOffset;
        }
      } else {
        // At EOF with no newline — don't scan partial trailing line
        setCompactOffsetCache(sessionFile, { boundaryOffset: cached.boundaryOffset, scannedUpTo: fileSize });
        return cached.boundaryOffset;
      }
    }

    const text = buf.toString('utf-8', 0, scanBytes);

    let lastBoundaryOffset = cached.boundaryOffset;
    let bytePos = cached.scannedUpTo;
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        try {
          const cleanLine = line.replace(/\r$/, '');
          const entry = JSON.parse(cleanLine);
          if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
            lastBoundaryOffset = bytePos;
          }
        } catch { /* skip invalid lines */ }
      }
      bytePos += Buffer.byteLength(line, 'utf-8') + 1; // +1 for \n
    }

    setCompactOffsetCache(sessionFile, { boundaryOffset: lastBoundaryOffset, scannedUpTo: cached.scannedUpTo + scanBytes });
    return lastBoundaryOffset;
  } finally {
    await fh.close();
  }
}
