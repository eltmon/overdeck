import { formatWorkspaceRelativePath } from './filePathDisplay';

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/;
const EXTERNAL_SCHEME_PATTERN = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/;
const RELATIVE_PATH_PREFIX_PATTERN = /^(~\/|\.{1,2}\/)/;
const RELATIVE_FILE_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?::\d+){0,2}$/;
const RELATIVE_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+\.[A-Za-z0-9_-]+(?::\d+){0,2}$/;
const POSITION_SUFFIX_PATTERN = /:\d+(?::\d+)?$/;
const POSITION_ONLY_PATTERN = /^\d+(?::\d+)?$/;
const POSIX_FILE_ROOT_PREFIXES = [
  '/Users/',
  '/home/',
  '/tmp/',
  '/var/',
  '/etc/',
  '/opt/',
  '/mnt/',
  '/Volumes/',
  '/private/',
  '/root/',
] as const;

export interface MarkdownFileLinkMeta {
  filePath: string;
  targetPath: string;
  displayPath: string;
  basename: string;
  line?: number;
  column?: number;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function unwrapMarkdownLinkDestination(value: string): string {
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
}

export function normalizeMarkdownLinkDestination(value: string): string {
  return unwrapMarkdownLinkDestination(value.trim());
}

function stripSearchAndHash(value: string): { path: string; hash: string } {
  const hashIndex = value.indexOf('#');
  const pathWithSearch = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const rawHash = hashIndex >= 0 ? value.slice(hashIndex) : '';
  const queryIndex = pathWithSearch.indexOf('?');
  const path = queryIndex >= 0 ? pathWithSearch.slice(0, queryIndex) : pathWithSearch;
  return { path, hash: rawHash };
}

function normalizeWindowsDrivePath(path: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path;
}

function parseFileUrlHref(
  href: string,
  options?: { readonly decodePath?: boolean },
): { path: string; hash: string } | null {
  try {
    const parsed = new URL(href);
    if (parsed.protocol.toLowerCase() !== 'file:') return null;

    const rawPath = parsed.pathname;
    if (rawPath.length === 0) return null;

    const normalizedPath = normalizeWindowsDrivePath(rawPath);

    return {
      path: options?.decodePath === false ? normalizedPath : safeDecode(normalizedPath),
      hash: parsed.hash,
    };
  } catch {
    return null;
  }
}

export function rewriteMarkdownFileUriHref(href: string | undefined): string | null {
  if (!href) return null;
  const normalizedHref = normalizeMarkdownLinkDestination(href);
  const target = parseFileUrlHref(normalizedHref, { decodePath: false });
  if (!target) return null;
  return `${target.path}${target.hash}`;
}

function looksLikePosixFilesystemPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (POSIX_FILE_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (POSITION_SUFFIX_PATTERN.test(path)) return true;
  const basename = path.slice(path.lastIndexOf('/') + 1);
  return /\.[A-Za-z0-9_-]+$/.test(basename);
}

function appendLineColumnFromHash(path: string, hash: string): string {
  if (!hash || POSITION_SUFFIX_PATTERN.test(path)) return path;
  const match = hash.match(/^#L(\d+)(?:C(\d+))?$/i);
  if (!match?.[1]) return path;
  const line = match[1];
  const column = match[2];
  return `${path}:${line}${column ? `:${column}` : ''}`;
}

function isLikelyPathCandidate(path: string): boolean {
  if (WINDOWS_DRIVE_PATH_PATTERN.test(path) || WINDOWS_UNC_PATH_PATTERN.test(path)) return true;
  if (RELATIVE_PATH_PREFIX_PATTERN.test(path)) return true;
  if (path.startsWith('/')) return looksLikePosixFilesystemPath(path);
  return RELATIVE_FILE_PATH_PATTERN.test(path) || RELATIVE_FILE_NAME_PATTERN.test(path);
}

function isRelativePath(path: string): boolean {
  return (
    RELATIVE_PATH_PREFIX_PATTERN.test(path) ||
    (!path.startsWith('/') &&
      !WINDOWS_DRIVE_PATH_PATTERN.test(path) &&
      !WINDOWS_UNC_PATH_PATTERN.test(path))
  );
}

function hasExternalScheme(path: string): boolean {
  const match = path.match(EXTERNAL_SCHEME_PATTERN);
  if (!match) return false;
  const rest = match[2] ?? '';
  if (rest.startsWith('//')) return true;
  return !POSITION_ONLY_PATTERN.test(rest);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || isWindowsAbsolutePath(value);
}

function isWindowsPathStyle(value: string): boolean {
  return isWindowsAbsolutePath(value) || /[A-Za-z]:\\/.test(value);
}

function joinPath(base: string, next: string, separator: '/' | '\\'): string {
  const cleanBase = base.replace(/[\\/]+$/, '');
  if (separator === '\\') {
    return `${cleanBase}\\${next.replaceAll('/', '\\')}`;
  }
  return `${cleanBase}/${next.replace(/^\/+/, '')}`;
}

function inferHomeFromCwd(cwd: string): string | undefined {
  const posixUser = cwd.match(/^\/Users\/([^/]+)/);
  if (posixUser?.[1]) {
    return `/Users/${posixUser[1]}`;
  }

  const posixHome = cwd.match(/^\/home\/([^/]+)/);
  if (posixHome?.[1]) {
    return `/home/${posixHome[1]}`;
  }

  const windowsUser = cwd.match(/^([A-Za-z]:\\Users\\[^\\]+)/);
  if (windowsUser?.[1]) {
    return windowsUser[1];
  }

  return undefined;
}

function splitPathAndPosition(value: string): {
  path: string;
  line: string | undefined;
  column: string | undefined;
} {
  let path = value;
  let column: string | undefined;
  let line: string | undefined;

  const columnMatch = path.match(/:(\d+)$/);
  if (!columnMatch?.[1]) {
    return { path, line: undefined, column: undefined };
  }

  column = columnMatch[1];
  path = path.slice(0, -columnMatch[0].length);

  const lineMatch = path.match(/:(\d+)$/);
  if (lineMatch?.[1]) {
    line = lineMatch[1];
    path = path.slice(0, -lineMatch[0].length);
  } else {
    line = column;
    column = undefined;
  }

  return { path, line, column };
}

function resolvePathLinkTarget(rawPath: string, cwd: string): string {
  const { path, line, column } = splitPathAndPosition(rawPath);

  let resolvedPath = path;
  if (path.startsWith('~/')) {
    const home = inferHomeFromCwd(cwd);
    if (home) {
      const separator: '/' | '\\' = isWindowsPathStyle(home) ? '\\' : '/';
      resolvedPath = joinPath(home, path.slice(2), separator);
    }
  } else if (!isAbsolutePath(path)) {
    const separator: '/' | '\\' = isWindowsPathStyle(cwd) ? '\\' : '/';
    resolvedPath = joinPath(cwd, path, separator);
  }

  if (!line) return resolvedPath;
  return `${resolvedPath}:${line}${column ? `:${column}` : ''}`;
}

export function resolveMarkdownFileLinkTarget(
  href: string | undefined,
  cwd?: string,
): string | null {
  if (!href) return null;
  const rawHref = normalizeMarkdownLinkDestination(href);
  if (rawHref.length === 0 || rawHref.startsWith('#')) return null;

  const fileUrlTarget = rawHref.toLowerCase().startsWith('file:')
    ? parseFileUrlHref(rawHref)
    : null;
  const source = fileUrlTarget ?? stripSearchAndHash(rawHref);
  const decodedPath = normalizeWindowsDrivePath(
    fileUrlTarget ? source.path.trim() : safeDecode(source.path.trim()),
  );
  const decodedHash = safeDecode(source.hash.trim());

  if (decodedPath.length === 0) return null;
  if (
    !WINDOWS_DRIVE_PATH_PATTERN.test(decodedPath) &&
    !WINDOWS_UNC_PATH_PATTERN.test(decodedPath) &&
    hasExternalScheme(decodedPath)
  ) {
    return null;
  }

  if (!isLikelyPathCandidate(decodedPath)) return null;

  const pathWithPosition = appendLineColumnFromHash(decodedPath, decodedHash);
  if (!isRelativePath(pathWithPosition)) {
    return pathWithPosition;
  }

  if (!cwd) return null;
  return resolvePathLinkTarget(pathWithPosition, cwd);
}

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

export function resolveMarkdownFileLinkMeta(
  href: string | undefined,
  cwd?: string,
): MarkdownFileLinkMeta | null {
  const targetPath = resolveMarkdownFileLinkTarget(href, cwd);
  if (!targetPath) return null;

  const { path, line, column } = splitPathAndPosition(targetPath);
  const parsedLine = line ? Number.parseInt(line, 10) : Number.NaN;
  const parsedColumn = column ? Number.parseInt(column, 10) : Number.NaN;
  const lineNumber = Number.isFinite(parsedLine) ? parsedLine : undefined;
  const columnNumber = Number.isFinite(parsedColumn) ? parsedColumn : undefined;

  return {
    filePath: path,
    targetPath,
    displayPath: formatWorkspaceRelativePath(targetPath, cwd),
    basename: basenameOfPath(path),
    ...(lineNumber !== undefined ? { line: lineNumber } : {}),
    ...(columnNumber !== undefined ? { column: columnNumber } : {}),
  };
}
