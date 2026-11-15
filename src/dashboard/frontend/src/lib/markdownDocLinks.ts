/**
 * Classifies a Markdown link href relative to the file it appears in, and
 * resolves a relative path against that file's folder (PAN-5337, WI-1).
 *
 * A document-relative href (`fort3d.md`, `../a.md`, `levels/`) has no URL
 * scheme and no leading `/`, so the browser cannot resolve it on its own —
 * callers need the classification to decide whether to open a file, reveal a
 * folder, scroll to a heading, or leave the link inert. This module has no
 * framework imports so it can be unit-tested without rendering anything.
 */

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/
const SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/
const POSITION_ONLY_PATTERN = /^\d+(?::\d+)?$/
const LINE_COLUMN_SUFFIX_PATTERN = /:(\d+)(?::(\d+))?$/
const HASH_LINE_COLUMN_PATTERN = /^#L(\d+)(?:C(\d+))?$/i

export type DocHref =
  | { kind: 'empty' }
  | { kind: 'fragment'; slug: string }
  | { kind: 'absolute' }
  | { kind: 'relative'; path: string; line?: number; column?: number; trailingSlash: boolean }

export type ResolvedDocPath = { kind: 'inside'; path: string } | { kind: 'outside' }

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function unwrapAngleBrackets(value: string): string {
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value
}

/** Classifies a Markdown link href as empty, a fragment, absolute, or document-relative. */
export function classifyDocHref(href: string | undefined): DocHref {
  const trimmed = unwrapAngleBrackets((href ?? '').trim())
  if (trimmed.length === 0) return { kind: 'empty' }
  if (trimmed.startsWith('#')) return { kind: 'fragment', slug: safeDecode(trimmed.slice(1)) }
  if (trimmed.startsWith('/') || WINDOWS_DRIVE_PATTERN.test(trimmed)) return { kind: 'absolute' }

  const schemeMatch = trimmed.match(SCHEME_PATTERN)
  const isPositionOnlyRemainder = schemeMatch ? POSITION_ONLY_PATTERN.test(schemeMatch[2] ?? '') : false
  if (schemeMatch && !isPositionOnlyRemainder) return { kind: 'absolute' }

  const hashIndex = trimmed.indexOf('#')
  const beforeHash = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : ''
  const queryIndex = beforeHash.indexOf('?')
  const rawPath = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const decodedPath = safeDecode(rawPath)
  const trailingSlash = decodedPath.endsWith('/')

  const suffixMatch = decodedPath.match(LINE_COLUMN_SUFFIX_PATTERN)
  if (suffixMatch) {
    const path = decodedPath.slice(0, decodedPath.length - suffixMatch[0].length)
    const column = suffixMatch[2]
    return {
      kind: 'relative',
      path,
      line: Number(suffixMatch[1]),
      ...(column !== undefined ? { column: Number(column) } : {}),
      trailingSlash,
    }
  }

  const hashLineMatch = hash.match(HASH_LINE_COLUMN_PATTERN)
  if (hashLineMatch) {
    const column = hashLineMatch[2]
    return {
      kind: 'relative',
      path: decodedPath,
      line: Number(hashLineMatch[1]),
      ...(column !== undefined ? { column: Number(column) } : {}),
      trailingSlash,
    }
  }

  return { kind: 'relative', path: decodedPath, trailingSlash }
}

/** True when `href` is document-relative (no scheme, no leading `/`, not a bare fragment). */
export function isDocumentRelativeHref(href: string | undefined): boolean {
  return classifyDocHref(href).kind === 'relative'
}

/** Resolves `relPath` against the folder `fromDir`, or reports that it leaves the root. */
export function resolveDocPath(fromDir: string, relPath: string): ResolvedDocPath {
  const stack = fromDir.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  const relSegments = relPath.split('/')
  if (relSegments[0] === '~') return { kind: 'outside' }
  for (const segment of relSegments) {
    if (segment.length === 0 || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return { kind: 'outside' }
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  return { kind: 'inside', path: stack.join('/') }
}

/** The folder containing `path`: `'docs/index.md'` → `'docs'`; `'README.md'` → `''`. */
export function docDirOf(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash === -1 ? '' : path.slice(0, lastSlash)
}
