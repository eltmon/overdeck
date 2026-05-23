/**
 * Unified Issue ID Parser
 *
 * Handles multiple issue ID formats:
 * - Standard:  PREFIX-NUMBER  (e.g., MIN-123, PAN-456)
 * - Rally:     TYPENUMBER     (e.g., F29698, US12345, DE118304, TA4567)
 * - Custom:    Per-project regex patterns
 */

import { Effect } from 'effect';
import type { ProjectConfig } from './projects.js';

/**
 * Parsed representation of any issue ID format.
 */
export interface ParsedIssueId {
  /** Original ID as provided (e.g., "MIN-123", "F29698") */
  raw: string;
  /** Extracted prefix for project resolution (e.g., "MIN", "F", "US") */
  prefix: string;
  /** Numeric portion (e.g., 123, 29698) */
  number: number;
  /** Normalized lowercase form for filesystem use (e.g., "min-123", "f29698") */
  normalized: string;
  /** Format that was matched */
  format: 'standard' | 'rally' | 'custom';
}

/**
 * Parse an issue ID into its components.
 *
 * Supports:
 * - Standard:  PREFIX-NUMBER  (e.g., MIN-123, PAN-456)
 * - Rally:     TYPENUMBER     (e.g., F29698, US12345, DE118304, TA4567)
 * - Custom:    Per-project regex patterns
 *
 * @param issueId - The raw issue ID string
 * @param projectConfig - Optional project config for custom patterns
 * @returns ParsedIssueId or null if no format matches
 */
export function parseIssueIdSync(issueId: string, projectConfig?: ProjectConfig): ParsedIssueId | null {
  // Standard format first (most common): PREFIX-NUMBER
  const standardMatch = issueId.match(/^([A-Za-z]+)-(\d+)$/);
  if (standardMatch) {
    return {
      raw: issueId,
      prefix: standardMatch[1].toUpperCase(),
      number: parseInt(standardMatch[2], 10),
      normalized: issueId.toLowerCase(),
      format: 'standard',
    };
  }

  // Rally format: TYPE_PREFIX followed by NUMBER (no separator)
  // Known Rally prefixes: F (Feature), US (User Story), DE (Defect),
  // TA (Task), TC (Test Case)
  const rallyMatch = issueId.match(/^(F|US|DE|TA|TC)(\d+)$/i);
  if (rallyMatch) {
    return {
      raw: issueId,
      prefix: rallyMatch[1].toUpperCase(),
      number: parseInt(rallyMatch[2], 10),
      normalized: issueId.toLowerCase(),
      format: 'rally',
    };
  }

  // Custom project pattern if provided
  if (projectConfig?.issue_pattern) {
    const customMatch = issueId.match(new RegExp(projectConfig.issue_pattern, 'i'));
    if (customMatch && customMatch[1] && customMatch[2]) {
      return {
        raw: issueId,
        prefix: customMatch[1].toUpperCase(),
        number: parseInt(customMatch[2], 10),
        normalized: issueId.toLowerCase(),
        format: 'custom',
      };
    }
  }

  return null;
}

/**
 * Extract just the team/project prefix from an issue ID.
 * Handles standard (MIN-123), Rally (F29698), and custom formats.
 */
export function extractPrefixSync(issueId: string): string | null {
  const parsed = parseIssueIdSync(issueId);
  return parsed?.prefix ?? null;
}

/**
 * Extract the numeric portion of an issue ID.
 * Handles standard (MIN-123), Rally (F29698), and custom formats.
 */
export function extractNumberSync(issueId: string): number | null {
  const parsed = parseIssueIdSync(issueId);
  return parsed?.number ?? null;
}

/**
 * Get the normalized (lowercase, filesystem-safe) form of an issue ID.
 * Standard IDs keep the dash: "min-123". Rally IDs stay concatenated: "f29698".
 */
export function normalizeIssueIdSync(issueId: string): string {
  const parsed = parseIssueIdSync(issueId);
  return parsed?.normalized ?? issueId.toLowerCase();
}

/**
 * Resolve an issue ID from either a raw issue ID or an agent session name.
 *
 * CLI commands accept both "PAN-123" and "agent-pan-123" as input.
 * This function strips the "agent-" prefix if present and returns the
 * canonical uppercase issue ID.
 *
 * Examples:
 *   resolveIssueId("PAN-123")       → "PAN-123"
 *   resolveIssueId("pan-123")       → "PAN-123"
 *   resolveIssueId("agent-pan-123") → "PAN-123"
 */
export function resolveIssueIdSync(input: string): string {
  const stripped = input.replace(/^agent-/i, '');
  return stripped.toUpperCase();
}

/**
 * Resolve a possibly-bare numeric ID (e.g., "1148") to a fully-prefixed
 * canonical ID (e.g., "PAN-1148") by probing the local agent state directory.
 *
 * Strategy:
 *   1. If input already has a prefix (PAN-1148, agent-pan-1148, F29698, etc.),
 *      delegate to resolveIssueId and return.
 *   2. If input is bare digits, scan ~/.panopticon/agents/ for state dirs
 *      matching `agent-<prefix>-<num>` with a valid state.json. If exactly
 *      one matches, return `<PREFIX>-<num>`.
 *   3. If zero matches → return null (caller decides how to fail).
 *   4. If multiple matches → return null (ambiguous; caller errors).
 *
 * Pure-sync, safe to call from CLI entry points. Reads filesystem only.
 */
export function resolveBareNumericIdSync(input: string, panopticonHome?: string): string | null {
  if (/^\d+$/.test(input)) {
    const home = panopticonHome ?? `${process.env.HOME}/.panopticon`;
    const agentsDir = `${home}/agents`;
    let dirents: string[];
    try {
      // Sync FS is acceptable in CLI entry points (server code uses fs/promises).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      if (!fs.existsSync(agentsDir)) return null;
      dirents = fs.readdirSync(agentsDir);
      const matches: string[] = [];
      const suffix = `-${input}`;
      for (const name of dirents) {
        if (!name.startsWith('agent-')) continue;
        if (!name.endsWith(suffix)) continue;
        const stateJson = `${agentsDir}/${name}/state.json`;
        if (!fs.existsSync(stateJson)) continue;
        // Extract the issueId from inside state.json — authoritative.
        try {
          const raw = fs.readFileSync(stateJson, 'utf-8');
          const parsed = JSON.parse(raw) as { issueId?: string };
          if (parsed.issueId && parsed.issueId.endsWith(`-${input}`)) {
            matches.push(parsed.issueId);
          }
        } catch {
          // Skip unreadable state files.
        }
      }
      if (matches.length === 1) return matches[0];
      return null;
    } catch {
      return null;
    }
  }
  return resolveIssueIdSync(input);
}

/**
 * Extract prefix from a standard format issue ID (PREFIX-NUMBER).
 * Returns null for non-standard formats like Rally IDs.
 * Use extractPrefix() for unified handling of all formats.
 */
export function extractStandardPrefixSync(issueId: string): string | null {
  const match = issueId.match(/^([A-Za-z]+)-\d+$/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract number from a standard format issue ID (PREFIX-NUMBER).
 * Returns null for non-standard formats like Rally IDs.
 * Use extractNumber() for unified handling of all formats.
 */
export function extractStandardNumberSync(issueId: string): number | null {
  const match = issueId.match(/^([A-Za-z]+)-(\d+)$/i);
  return match ? parseInt(match[2], 10) : null;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Pure-sync id parsing — additive Effect.sync wrappers. resolveBareNumericId
// reads the filesystem but is wrapped sync-only to mirror the existing API
// (it's used from CLI entry points where sync FS is acceptable).

/** Parse an issue id into prefix/number/format. Pure. */
export const parseIssueId = (
  issueId: string,
  projectConfig?: ProjectConfig,
): Effect.Effect<ParsedIssueId | null> =>
  Effect.sync(() => parseIssueIdSync(issueId, projectConfig));

/** Extract the team/project prefix. Pure. */
export const extractPrefix = (issueId: string): Effect.Effect<string | null> =>
  Effect.sync(() => extractPrefixSync(issueId));

/** Extract the numeric portion. Pure. */
export const extractNumber = (issueId: string): Effect.Effect<number | null> =>
  Effect.sync(() => extractNumberSync(issueId));

/** Lowercase filesystem-safe form. Pure. */
export const normalizeIssueId = (issueId: string): Effect.Effect<string> =>
  Effect.sync(() => normalizeIssueIdSync(issueId));

/** Resolve either a raw issue id or an agent session name to canonical id. Pure. */
export const resolveIssueId = (input: string): Effect.Effect<string> =>
  Effect.sync(() => resolveIssueIdSync(input));

/** Resolve a bare numeric id by probing local agent state (sync FS). */
export const resolveBareNumericId = (
  input: string,
  panopticonHome?: string,
): Effect.Effect<string | null> =>
  Effect.sync(() => resolveBareNumericIdSync(input, panopticonHome));

/** Extract prefix from a standard `PREFIX-NUMBER` id only. Pure. */
export const extractStandardPrefix = (
  issueId: string,
): Effect.Effect<string | null> => Effect.sync(() => extractStandardPrefixSync(issueId));

/** Extract number from a standard `PREFIX-NUMBER` id only. Pure. */
export const extractStandardNumber = (
  issueId: string,
): Effect.Effect<number | null> => Effect.sync(() => extractStandardNumberSync(issueId));
