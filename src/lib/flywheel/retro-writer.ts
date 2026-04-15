/**
 * Retro markdown writer + schema self-validation (PAN-709, bead eeb)
 *
 * Validates retro output from retro-agent against the schema before writing.
 * Rejects invalid retros (missing fields, wrong types, no-op required).
 *
 * File convention: docs/flywheel/retros/<issue-id>-<unix-ts>.md
 */

import { promises as fsPromises } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

/** A single proposed change entry in the retro frontmatter. */
export type ProposedChange =
  | { type: 'add_skill'; name: string; audience: string; purpose: string }
  | { type: 'update_skill'; name: string; section: string; change: string }
  | { type: 'deprecate_skill'; name: string; reason: string }
  | { type: 'file_substrate_issue'; title: string; reason: string }
  | { type: 'no_op'; reason: string };

/** The validated retro frontmatter schema. */
export interface RetroFrontmatter {
  issue: string;
  agent: string;
  run: string | number;
  cycle_count: number;
  /** Friction score 0-10. Higher = more friction encountered. */
  friction_score: number;
  surprise: boolean;
  /** At least one proposed change OR a no_op entry is required. */
  proposed_changes: ProposedChange[];
}

/** A complete validated retro document. */
export interface RetroDocument {
  frontmatter: RetroFrontmatter;
  body: string;
}

export interface RetroValidationError {
  field: string;
  message: string;
}

export interface RetroValidationResult {
  valid: boolean;
  errors: RetroValidationError[];
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a retro document against the schema.
 * Returns valid=true only when all required fields are present and well-typed.
 */
export function validateRetro(doc: RetroDocument): RetroValidationResult {
  const errors: RetroValidationError[] = [];
  const fm = doc.frontmatter;

  // Required string fields
  if (!fm.issue || typeof fm.issue !== 'string' || fm.issue.trim() === '') {
    errors.push({ field: 'issue', message: 'Missing or empty required field: issue' });
  }
  if (!fm.agent || typeof fm.agent !== 'string' || fm.agent.trim() === '') {
    errors.push({ field: 'agent', message: 'Missing or empty required field: agent' });
  }
  if (fm.run === undefined || fm.run === null || fm.run === '') {
    errors.push({ field: 'run', message: 'Missing required field: run' });
  }

  // cycle_count: non-negative integer
  if (typeof fm.cycle_count !== 'number' || !Number.isInteger(fm.cycle_count) || fm.cycle_count < 0) {
    errors.push({ field: 'cycle_count', message: 'cycle_count must be a non-negative integer' });
  }

  // friction_score: 0-10 (can be float)
  if (typeof fm.friction_score !== 'number' || fm.friction_score < 0 || fm.friction_score > 10) {
    errors.push({ field: 'friction_score', message: 'friction_score must be a number between 0 and 10' });
  }

  // surprise: boolean
  if (typeof fm.surprise !== 'boolean') {
    errors.push({ field: 'surprise', message: 'surprise must be a boolean (true or false)' });
  }

  // proposed_changes: must be an array with at least one entry OR contain a no_op
  if (!Array.isArray(fm.proposed_changes)) {
    errors.push({ field: 'proposed_changes', message: 'proposed_changes must be an array' });
  } else if (fm.proposed_changes.length === 0) {
    errors.push({
      field: 'proposed_changes',
      message: 'proposed_changes must have at least one entry (use { type: "no_op", reason: "..." } for boring merges)',
    });
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Parser — simple YAML-like frontmatter reader
// ============================================================================

/**
 * Parse a retro markdown string into a RetroDocument.
 * Returns null if the file does not start with YAML frontmatter.
 */
export function parseRetroMarkdown(content: string): RetroDocument | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const rawFm = match[1];
  const body = match[2] ?? '';

  // Simple key: value parser (handles string, number, boolean)
  const fm: Record<string, unknown> = {};
  const lines = rawFm.split('\n');
  let currentKey: string | null = null;
  let inList = false;
  const listItems: unknown[] = [];

  for (const line of lines) {
    const kvMatch = line.match(/^([\w_]+):\s*(.*)?$/);
    if (kvMatch) {
      // Flush previous list
      if (currentKey && inList) {
        fm[currentKey] = listItems.splice(0);
        inList = false;
      }
      currentKey = kvMatch[1];
      const val = (kvMatch[2] ?? '').trim();
      if (val === '' || val === '[]') {
        inList = val !== '[]';
        fm[currentKey] = val === '[]' ? [] : undefined;
      } else if (val === 'true') {
        fm[currentKey] = true;
      } else if (val === 'false') {
        fm[currentKey] = false;
      } else if (/^\d+(\.\d+)?$/.test(val)) {
        fm[currentKey] = parseFloat(val);
      } else {
        fm[currentKey] = val.replace(/^["']|["']$/g, '');
      }
      continue;
    }

    // List item (- key: value or - {type: ...})
    const listItemMatch = line.match(/^\s+-\s+(.+)$/);
    if (listItemMatch && currentKey) {
      inList = true;
      const itemStr = listItemMatch[1].trim();
      // Parse simple "key: value | key: value" style
      const item: Record<string, string> = {};
      for (const part of itemStr.split('|')) {
        const kv = part.trim().match(/^([\w_]+):\s*(.*)$/);
        if (kv) item[kv[1].trim()] = kv[2].trim();
      }
      if (Object.keys(item).length > 0) listItems.push(item);
      else listItems.push(itemStr);
      continue;
    }
  }

  // Flush final list
  if (currentKey && inList) {
    fm[currentKey] = listItems;
  }

  return {
    frontmatter: fm as unknown as RetroFrontmatter,
    body: body.trim(),
  };
}

// ============================================================================
// Writer
// ============================================================================

const RETROS_DIR = join(homedir(), 'docs', 'flywheel', 'retros');

/**
 * Build the retro file path for a given issue and timestamp.
 */
export function buildRetroFilePath(issueId: string, ts: number = Date.now(), retrosDir: string = RETROS_DIR): string {
  return join(retrosDir, `${issueId.toLowerCase()}-${ts}.md`);
}

/**
 * Write a validated retro document to disk.
 *
 * @param content - Raw markdown string from retro-agent output
 * @param issueId - Issue ID for the file path
 * @param retrosDir - Override for the retros directory (default: ~/docs/flywheel/retros/)
 * @returns The path written to
 * @throws {Error} if the retro fails schema validation
 */
export async function writeRetro(
  content: string,
  issueId: string,
  retrosDir: string = RETROS_DIR,
): Promise<string> {
  const doc = parseRetroMarkdown(content);
  if (!doc) {
    throw new Error('Retro output does not have valid YAML frontmatter — cannot write');
  }

  const result = validateRetro(doc);
  if (!result.valid) {
    const msgs = result.errors.map(e => `  ${e.field}: ${e.message}`).join('\n');
    throw new Error(`Retro schema validation failed:\n${msgs}`);
  }

  const ts = Date.now();
  const filePath = buildRetroFilePath(issueId, ts, retrosDir);
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, content, 'utf-8');
  return filePath;
}
