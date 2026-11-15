/**
 * Conversation references (PAN-5339 WI-1).
 *
 * Recognizes text that names another conversation inside a rendered message —
 * a name (`20261113-6031`, `conv-20261113-6031`), a numbered form
 * (`conv 3904`, `conversation 3904`, `conv #3904`), or a `/conv/<key>` path or
 * URL — and reduces each to a reference key: the decimal id string for
 * numbered/numeric-path forms, the bare name (no `conv-` prefix) for name
 * forms. Resolving a key to an actual conversation is the resolution hook's
 * job (WI-3); this module only finds candidates and extracts keys.
 */
import type { Conversation } from '../components/CommandDeck/ConversationList';

export interface ConversationReferenceSegment {
  text: string;
  key?: string;
}

export interface ConversationRef {
  key: string;
  routeKey: string;
  name: string;
  title: string | null;
  isCurrent: boolean;
  conversation: Conversation;
}

export type ConversationRefMap = ReadonlyMap<string, ConversationRef>;

export const EMPTY_CONVERSATION_REFS: ConversationRefMap = new Map();

// D11: the three strict patterns, applied left to right with earliest match winning.
const NAME_PATTERN = /(?<![\w/.-])(conv-)?(\d{8}-[0-9a-f]{4})(?![\w-]|[./]\w)/g;
const NUMBERED_PATTERN = /\b(?:conversation|conv)[ \t]+#?(\d{1,7})(?![\w-])/gi;
const PATH_PATTERN = /(?<![\w.:/-])\/conv\/(\d{1,9}|\d{8}-[0-9a-f]{4})(?![\w/-]|\.\w)/g;

// D10: a looser path pattern (no lookbehind) for candidate-key scanning only,
// so a key embedded in a link destination or absolute URL (where the
// character before "/conv/" is part of a host or an opening paren) is still
// found. Over-matching here just means a wasted resolve lookup.
const LOOSE_PATH_PATTERN = /\/conv\/(\d{1,9}|\d{8}-[0-9a-f]{4})(?![\w/-]|\.\w)/g;

const QUICK_CHECK_PATTERN = /conv|\d{8}-[0-9a-f]{4}/i;

interface PatternMatch {
  start: number;
  end: number;
  text: string;
  key: string;
}

function collectPatternMatches(text: string, pattern: RegExp, keyGroup: number): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    matches.push({ start, end: start + m[0].length, text: m[0], key: m[keyGroup] });
  }
  return matches;
}

function strictMatches(text: string): PatternMatch[] {
  return [
    ...collectPatternMatches(text, NAME_PATTERN, 2),
    ...collectPatternMatches(text, NUMBERED_PATTERN, 1),
    ...collectPatternMatches(text, PATH_PATTERN, 1),
  ].sort((a, b) => a.start - b.start);
}

/** Earliest match wins; a later match that overlaps a kept one is dropped. */
function dedupeOverlaps(matches: PatternMatch[]): PatternMatch[] {
  const result: PatternMatch[] = [];
  let lastEnd = -1;
  for (const match of matches) {
    if (match.start < lastEnd) continue;
    result.push(match);
    lastEnd = match.end;
  }
  return result;
}

function stripFencedCodeBlocks(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '');
}

/** Cheap pre-check: true means "might contain a reference", never a false negative. */
export function mayContainConversationReference(text: string): boolean {
  return QUICK_CHECK_PATTERN.test(text);
}

/** Splits text into plain/keyed segments; a keyed segment's `text` is the original matched substring. */
export function splitConversationReferences(text: string): ConversationReferenceSegment[] {
  const matches = dedupeOverlaps(strictMatches(text));
  if (matches.length === 0) return [{ text }];
  const segments: ConversationReferenceSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start) });
    segments.push({ text: match.text, key: match.key });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/** Whole-string match only (for an inline code span's trimmed content) → its key, else null. */
export function parseConversationReference(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const matches = strictMatches(trimmed);
  if (matches.length !== 1) return null;
  const [match] = matches;
  return match.start === 0 && match.end === trimmed.length ? match.key : null;
}

const CONV_PATH_PATTERN = /^\/conv\/(\d{1,9}|\d{8}-[0-9a-f]{4})$/;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost');
}

/**
 * D7: a `/conv/<key>` relative href, or an absolute http(s) URL whose origin
 * matches `location` or whose hostname and `location`'s are both loopback.
 * Optional `?query`/`#hash` on either form is ignored.
 */
export function parseConversationHref(
  href: string | undefined,
  location: Pick<Location, 'origin' | 'hostname'> = window.location,
): string | null {
  if (!href) return null;
  let pathname: string;
  if (/^https?:\/\//i.test(href)) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    const sameOrigin = url.origin === location.origin;
    const bothLoopback = isLoopbackHostname(url.hostname) && isLoopbackHostname(location.hostname);
    if (!sameOrigin && !bothLoopback) return null;
    pathname = url.pathname;
  } else if (href.startsWith('/')) {
    pathname = href.split(/[?#]/, 1)[0];
  } else {
    return null;
  }
  const match = CONV_PATH_PATTERN.exec(pathname);
  return match ? match[1] : null;
}

/** D10: candidate keys for resolution, scanned from raw Markdown with fenced blocks removed; capped at `limit`. */
export function collectConversationReferenceKeys(markdown: string, limit = 20): string[] {
  const stripped = stripFencedCodeBlocks(markdown);
  const combined = [...strictMatches(stripped), ...collectPatternMatches(stripped, LOOSE_PATH_PATTERN, 1)].sort(
    (a, b) => a.start - b.start,
  );
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const match of combined) {
    if (seen.has(match.key)) continue;
    seen.add(match.key);
    keys.push(match.key);
    if (keys.length >= limit) break;
  }
  return keys;
}
