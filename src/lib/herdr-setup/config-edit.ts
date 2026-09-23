/**
 * The pure edit behind `[session] resume_agents_on_restore = false`
 * (PAN-3956 W6; hardened after the review of #3995, findings 4 and 11).
 *
 * The file is the user's, so it is edited line by line and every other byte
 * survives: comments (including one at the end of the key's own line), other
 * sections, user keys and each line's own line ending. A small TOML line
 * scanner tells headers and keys apart from the inside of multi-line arrays
 * and strings, and understands spaced (`[ session ]`), quoted and dotted keys.
 *
 * Nothing is trusted to the scanner alone: an edit is accepted only when the
 * result parses, says `false`, and — with that one key removed — parses to
 * exactly what the original did. When no edit passes, the plan is `refused`
 * with the line to add by hand; nothing is written.
 *
 * Herdr reads its config with the Rust `toml` 0.8 / `toml_edit` crates (TOML
 * 1.0: mixed-type arrays and so on), so the parser here is `toml` 4 (TOML
 * 1.x), not the TOML 0.5 `@iarna/toml`. A leading BOM is skipped. `herdr config
 * check` stays the authority on validity: a file this parser cannot read is
 * never called broken on its own say-so (see `ensureHerdrConfig`).
 */

import { parse as parseToml } from 'toml';

export const RESUME_KEY = 'resume_agents_on_restore';
export const DESIRED_LINE = `${RESUME_KEY} = false`;

export type ResumeEditPlan =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'edited'; readonly text: string }
  | {
      readonly kind: 'refused';
      readonly reason: string;
      readonly hint: string;
      /** Set when Overdeck's parser could not read the file at all. */
      readonly parseError?: string;
    };

/** Parse Herdr config text as TOML 1.x, skipping a leading BOM. Throws on a parse error. */
export function parseHerdrConfigToml(text: string): Record<string, unknown> {
  return parseToml(text.startsWith('\uFEFF') ? text.slice(1) : text) as Record<string, unknown>;
}

function parseErrorMessage(error: unknown): string {
  return error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
}

const HAND_FIX_HINT = `add \`${DESIRED_LINE}\` under \`[session]\``;

/** A statement the scanner found at the start of a line. */
type LineInfo =
  | { readonly kind: 'blank' | 'comment' | 'continuation' | 'other' }
  | { readonly kind: 'header'; readonly table: readonly string[] | null }
  | {
      readonly kind: 'key';
      readonly table: readonly string[] | null;
      readonly key: readonly string[];
      /** Index where the value starts. */
      readonly valueStart: number;
      /** Index just past the value (before trailing spaces and any comment). */
      readonly valueEnd: number;
      /** True when the value ends on this line. */
      readonly singleLine: boolean;
    };

interface ScanState {
  depth: number;
  multiline: '"""' | "'''" | null;
}

const BARE_KEY = /[A-Za-z0-9_-]/;

/** A dotted key at `pos`: bare, "basic" and 'literal' parts. Null when malformed. */
function readKeyPath(line: string, start: number): { parts: string[]; end: number } | null {
  const parts: string[] = [];
  let pos = start;
  for (;;) {
    while (line[pos] === ' ' || line[pos] === '\t') pos++;
    const ch = line[pos];
    if (ch === '"') {
      let value = '';
      pos++;
      while (pos < line.length && line[pos] !== '"') {
        if (line[pos] === '\\') {
          const next = line[pos + 1];
          value += next === 'n' ? '\n' : next === 't' ? '\t' : (next ?? '');
          pos += 2;
        } else {
          value += line[pos++];
        }
      }
      if (line[pos] !== '"') return null;
      pos++;
      parts.push(value);
    } else if (ch === "'") {
      const close = line.indexOf("'", pos + 1);
      if (close < 0) return null;
      parts.push(line.slice(pos + 1, close));
      pos = close + 1;
    } else {
      const begin = pos;
      while (pos < line.length && BARE_KEY.test(line[pos] as string)) pos++;
      if (pos === begin) return null;
      parts.push(line.slice(begin, pos));
    }
    while (line[pos] === ' ' || line[pos] === '\t') pos++;
    if (line[pos] !== '.') return { parts, end: pos };
    pos++;
  }
}

/**
 * Advance the scan state over `line` from `pos`: strings (single- and
 * multi-line), comments, and `[`/`{` nesting. Returns the index where a
 * trailing comment starts (or the line length) — the end of the value text.
 */
function scanValue(line: string, pos: number, state: ScanState): number {
  let i = pos;
  while (i < line.length) {
    if (state.multiline) {
      const close = line.indexOf(state.multiline, i);
      if (close < 0) return line.length;
      i = close + 3;
      // A closing delimiter may be followed by up to two more quotes.
      while (line[i] === state.multiline[0]) i++;
      state.multiline = null;
      continue;
    }
    const ch = line[i];
    if (ch === '#') return i;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      state.multiline = line.startsWith('"""', i) ? '"""' : "'''";
      i += 3;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (ch === "'") {
      const close = line.indexOf("'", i + 1);
      i = close < 0 ? line.length : close + 1;
      continue;
    }
    if (ch === '[' || ch === '{') state.depth++;
    else if (ch === ']' || ch === '}') state.depth = Math.max(0, state.depth - 1);
    i++;
  }
  return line.length;
}

/** Classify every line (text without its `\r`). */
function scanLines(lines: readonly string[]): LineInfo[] {
  const state: ScanState = { depth: 0, multiline: null };
  let table: readonly string[] | null = [];
  const infos: LineInfo[] = [];
  for (const line of lines) {
    if (state.multiline || state.depth > 0) {
      scanValue(line, 0, state);
      infos.push({ kind: 'continuation' });
      continue;
    }
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    if (trimmed === '') {
      infos.push({ kind: 'blank' });
      continue;
    }
    if (trimmed.startsWith('#')) {
      infos.push({ kind: 'comment' });
      continue;
    }
    if (trimmed.startsWith('[')) {
      const arrayTable = trimmed.startsWith('[[');
      const path = readKeyPath(line, indent + (arrayTable ? 2 : 1));
      const close = arrayTable ? ']]' : ']';
      const rest = path ? line.slice(path.end) : '';
      const wellFormed = path !== null && rest.startsWith(close) && /^\s*(#.*)?$/.test(rest.slice(close.length));
      // An array-of-tables element is never the `[session]` table.
      table = wellFormed && !arrayTable ? path.parts : null;
      infos.push({ kind: 'header', table });
      continue;
    }
    const key = readKeyPath(line, indent);
    if (!key || line[key.end] !== '=') {
      infos.push({ kind: 'other' });
      continue;
    }
    let valueStart = key.end + 1;
    while (line[valueStart] === ' ' || line[valueStart] === '\t') valueStart++;
    const commentAt = scanValue(line, valueStart, state);
    let valueEnd = commentAt;
    while (valueEnd > valueStart && (line[valueEnd - 1] === ' ' || line[valueEnd - 1] === '\t')) valueEnd--;
    infos.push({
      kind: 'key',
      table,
      key: key.parts,
      valueStart,
      valueEnd,
      singleLine: state.depth === 0 && state.multiline === null,
    });
  }
  return infos;
}

function samePath(a: readonly string[] | null, b: readonly string[]): boolean {
  return a !== null && a.length === b.length && a.every((part, i) => part === b[i]);
}

/** Full key path of a key line (its table + its dotted key). */
function fullPath(info: Extract<LineInfo, { kind: 'key' }>): string[] | null {
  return info.table === null ? null : [...info.table, ...info.key];
}

function canonical(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (value instanceof Date) return JSON.stringify(Number.isNaN(value.getTime()) ? String(value) : value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** The parsed document with `session.resume_agents_on_restore` removed (and an emptied `session` dropped). */
function withoutResumeKey(doc: Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...doc };
  const session = copy.session;
  if (session && typeof session === 'object' && !Array.isArray(session)) {
    const rest: Record<string, unknown> = { ...(session as Record<string, unknown>) };
    delete rest[RESUME_KEY];
    if (Object.keys(rest).length === 0) delete copy.session;
    else copy.session = rest;
  }
  return canonical(copy);
}

function parseDoc(text: string): Record<string, unknown> | null {
  try {
    return parseHerdrConfigToml(text);
  } catch {
    return null;
  }
}

function resumeValue(doc: Record<string, unknown>): unknown {
  const session = doc.session;
  return session && typeof session === 'object' && !Array.isArray(session)
    ? (session as Record<string, unknown>)[RESUME_KEY]
    : undefined;
}

/** True when `next` says `false` and differs from `before` in nothing else. */
function verifies(next: string, before: Record<string, unknown>): boolean {
  const doc = parseDoc(next);
  return doc !== null && resumeValue(doc) === false && withoutResumeKey(doc) === withoutResumeKey(before);
}

const COMMENTED_DEFAULT = /^(\s*)#\s*resume_agents_on_restore\s*=\s*(true|false)\s*$/;

/** Candidate edits, most specific first. Each is verified before it is used. */
function* candidates(parts: readonly string[], lines: readonly string[], infos: readonly LineInfo[], eol: string): Generator<string> {
  const join = (next: readonly string[]) => next.join('\n');
  const withEol = (line: string) => `${line}${eol === '\r\n' ? '\r' : ''}`;
  const cr = (i: number) => (parts[i]?.endsWith('\r') ? '\r' : '');

  // 1. The live key — `[session]` key, root dotted `session.…`, quoted — its value only.
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i] as LineInfo;
    if (info.kind !== 'key' || !info.singleLine || !samePath(fullPath(info), ['session', RESUME_KEY])) continue;
    const line = lines[i] as string;
    const next = [...parts];
    next[i] = `${line.slice(0, info.valueStart)}false${line.slice(info.valueEnd)}${cr(i)}`;
    yield join(next);
  }

  // 2. The commented default (`# resume_agents_on_restore = true`) in [session] — exact form only,
  //    never a prose comment that merely starts with the key name.
  let sessionHeader = -1;
  let table: readonly string[] | null = [];
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i] as LineInfo;
    if (info.kind === 'header') {
      table = info.table;
      if (sessionHeader < 0 && samePath(table, ['session'])) sessionHeader = i;
      continue;
    }
    if (info.kind !== 'comment' || !samePath(table, ['session'])) continue;
    const match = COMMENTED_DEFAULT.exec(lines[i] as string);
    if (!match) continue;
    const next = [...parts];
    next[i] = `${match[1] ?? ''}${DESIRED_LINE}${cr(i)}`;
    yield join(next);
  }

  // 3. Right after the `[session]` header.
  if (sessionHeader >= 0) {
    const next = [...parts];
    next.splice(sessionHeader + 1, 0, withEol(DESIRED_LINE));
    yield join(next);
  }

  // 4. `session` built from root dotted keys only: add one more beside the last of them.
  let lastRootSessionKey = -1;
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i] as LineInfo;
    if (info.kind === 'key' && samePath(info.table, []) && info.key.length > 1 && info.key[0] === 'session') {
      lastRootSessionKey = i;
    }
  }
  if (lastRootSessionKey >= 0) {
    let at = lastRootSessionKey + 1;
    while (at < infos.length && infos[at]?.kind === 'continuation') at++;
    const next = [...parts];
    next.splice(at, 0, withEol(`session.${DESIRED_LINE}`));
    yield join(next);
  }

  // 5. A new `[session]` table at the end.
  const text = join(parts);
  const base = text === '' || text.endsWith('\n') ? text : `${text}${eol}`;
  yield `${base}${base === '' ? '' : eol}[session]${eol}${DESIRED_LINE}${eol}`;
}

/**
 * Plan the edit that makes the file say `[session] resume_agents_on_restore =
 * false`. `unchanged` when it already does (in any TOML shape).
 */
export function planResumeAgentsOnRestore(text: string): ResumeEditPlan {
  if (text.trim() === '') return { kind: 'edited', text: `[session]\n${DESIRED_LINE}\n` };

  let before: Record<string, unknown>;
  try {
    before = parseHerdrConfigToml(text);
  } catch (error) {
    const parseError = parseErrorMessage(error);
    return {
      kind: 'refused',
      reason: `Overdeck's TOML parser cannot read it (${parseError}), so Overdeck will not edit it`,
      hint: HAND_FIX_HINT,
      parseError,
    };
  }
  if (resumeValue(before) === false) return { kind: 'unchanged' };
  const session = before.session;
  if (session !== undefined && (typeof session !== 'object' || session === null || Array.isArray(session) || session instanceof Date)) {
    return { kind: 'refused', reason: '`session` is not a table', hint: HAND_FIX_HINT };
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const parts = text.split('\n');
  const lines = parts.map((part) => (part.endsWith('\r') ? part.slice(0, -1) : part));
  const infos = scanLines(lines);
  for (const next of candidates(parts, lines, infos, eol)) {
    if (verifies(next, before)) return { kind: 'edited', text: next };
  }
  const inlineTable = infos.some((info) => info.kind === 'key' && samePath(fullPath(info), ['session']));
  if (inlineTable) {
    return {
      kind: 'refused',
      reason: '`session` is an inline table (`session = { … }`), which Overdeck does not rewrite',
      hint: `set \`${RESUME_KEY} = false\` inside the \`session = { … }\` inline table`,
    };
  }
  return {
    kind: 'refused',
    reason: `no line edit could set ${RESUME_KEY} = false without changing anything else`,
    hint: HAND_FIX_HINT,
  };
}

/**
 * Conservative line-level read for a file the TOML parser cannot read: true
 * only when exactly one live `resume_agents_on_restore` line applies to
 * `session` (in `[session]` or as a root dotted key), it is single-line and
 * its value is exactly `false`, and `session` is not an inline table.
 */
export function lineLevelResumeDisabled(text: string): boolean {
  const lines = text.split('\n').map((part) => (part.endsWith('\r') ? part.slice(0, -1) : part));
  const infos = scanLines(lines);
  const keyLines: number[] = [];
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i] as LineInfo;
    if (info.kind !== 'key') continue;
    const path = fullPath(info);
    if (samePath(path, ['session'])) return false;
    if (samePath(path, ['session', RESUME_KEY])) keyLines.push(i);
  }
  if (keyLines.length !== 1) return false;
  const index = keyLines[0] as number;
  const info = infos[index] as Extract<LineInfo, { kind: 'key' }>;
  return info.singleLine && (lines[index] as string).slice(info.valueStart, info.valueEnd) === 'false';
}
