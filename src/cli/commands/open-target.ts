/**
 * Parse the target of `pan open` (PAN-5349 O-D2), first match wins:
 *   1. `~` expanded and resolved against `cwd`, the path exists → a path;
 *   2. `<path>:<line>[:<column>]` whose path part exists → a path at a position;
 *   3. an issue id (`PAN-123`, or bare digits that name one agent) → an issue;
 *   4. otherwise invalid.
 * A Windows drive path such as `C:\x` never matches rule 2: a digit must follow the colon.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseIssueId, resolveBareNumericId } from '../../lib/issue-id.js';

export type OpenTarget =
  | { kind: 'path'; abs: string; line?: number; column?: number }
  | { kind: 'issue'; id: string }
  | { kind: 'invalid' };

export interface OpenTargetDeps {
  exists: (path: string) => boolean;
  resolveIssue: (raw: string) => string | null;
}

/**
 * `resolveBareNumericId` upper-cases any string, so only an id that parses as
 * an issue id (`PAN-123`, `agent-pan-123`, a Rally id, or bare digits naming
 * one agent) counts; anything else stays invalid.
 */
function resolveIssueTarget(raw: string): string | null {
  const id = resolveBareNumericId(raw);
  return id && parseIssueId(id) ? id : null;
}

const defaultDeps: OpenTargetDeps = { exists: existsSync, resolveIssue: resolveIssueTarget };

// `:line:column` is tried before `:line`, so `f.ts:12:3` is not read as the file `f.ts:12`
// (a greedy `^(.*):(\d+)(?::(\d+))?$` would capture `f.ts:12` as the path).
const LINE_COLUMN_SUFFIX = /^(.+):(\d+):(\d+)$/;
const LINE_SUFFIX = /^(.+):(\d+)$/;

function expand(raw: string, cwd: string, home: string): string {
  const tilde = raw === '~' ? home : raw.startsWith('~/') ? `${home}${raw.slice(1)}` : raw;
  return resolve(cwd, tilde);
}

export function parseOpenTarget(raw: string, cwd: string, home: string, deps: Partial<OpenTargetDeps> = {}): OpenTarget {
  const { exists, resolveIssue } = { ...defaultDeps, ...deps };
  if (!raw) return { kind: 'invalid' };

  const abs = expand(raw, cwd, home);
  if (exists(abs)) return { kind: 'path', abs };

  const withColumn = LINE_COLUMN_SUFFIX.exec(raw);
  if (withColumn) {
    const base = expand(withColumn[1]!, cwd, home);
    const line = Number(withColumn[2]);
    const column = Number(withColumn[3]);
    if (line > 0 && column > 0 && exists(base)) return { kind: 'path', abs: base, line, column };
  }
  const withLine = LINE_SUFFIX.exec(raw);
  if (withLine) {
    const base = expand(withLine[1]!, cwd, home);
    const line = Number(withLine[2]);
    if (line > 0 && exists(base)) return { kind: 'path', abs: base, line };
  }

  const id = resolveIssue(raw);
  return id ? { kind: 'issue', id } : { kind: 'invalid' };
}
