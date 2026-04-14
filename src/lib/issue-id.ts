/**
 * Unified Issue ID Parser
 *
 * Handles multiple issue ID formats:
 * - Standard:  PREFIX-NUMBER  (e.g., MIN-123, PAN-456)
 * - Rally:     TYPENUMBER     (e.g., F29698, US12345, DE118304, TA4567)
 * - Custom:    Per-project regex patterns
 */

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
export function parseIssueId(issueId: string, projectConfig?: ProjectConfig): ParsedIssueId | null {
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
export function extractPrefix(issueId: string): string | null {
  const parsed = parseIssueId(issueId);
  return parsed?.prefix ?? null;
}

/**
 * Extract the numeric portion of an issue ID.
 * Handles standard (MIN-123), Rally (F29698), and custom formats.
 */
export function extractNumber(issueId: string): number | null {
  const parsed = parseIssueId(issueId);
  return parsed?.number ?? null;
}

/**
 * Get the normalized (lowercase, filesystem-safe) form of an issue ID.
 * Standard IDs keep the dash: "min-123". Rally IDs stay concatenated: "f29698".
 */
export function normalizeIssueId(issueId: string): string {
  const parsed = parseIssueId(issueId);
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
export function resolveIssueId(input: string): string {
  const stripped = input.replace(/^agent-/i, '');
  return stripped.toUpperCase();
}

/**
 * Extract prefix from a standard format issue ID (PREFIX-NUMBER).
 * Returns null for non-standard formats like Rally IDs.
 * Use extractPrefix() for unified handling of all formats.
 */
export function extractStandardPrefix(issueId: string): string | null {
  const match = issueId.match(/^([A-Za-z]+)-\d+$/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Extract number from a standard format issue ID (PREFIX-NUMBER).
 * Returns null for non-standard formats like Rally IDs.
 * Use extractNumber() for unified handling of all formats.
 */
export function extractStandardNumber(issueId: string): number | null {
  const match = issueId.match(/^([A-Za-z]+)-(\d+)$/i);
  return match ? parseInt(match[2], 10) : null;
}
