/**
 * PAN-1862: Pure helper — compute which reviewer sub-roles should run in a re-review cycle.
 *
 * Quality-first principle (decision D1, NFR-1): when scope='changed', we INCLUDE a reviewer
 * if uncertain. A false positive (reviewer runs when not strictly needed) costs tokens;
 * a false negative (reviewer skipped when it should run) costs quality. Fail safe toward quality.
 */

import type { ReReviewScope, ReviewMode } from '../config-yaml.js';
import type { ReviewSubRole } from './review-monitor.js';

export type { ReReviewScope, ReviewMode };

/** Verdict shape stored per-sub-role in ReviewStatus.reviewerVerdicts */
export interface PriorVerdict {
  status: 'passed' | 'blocked';
  atCommit: string;
  findingsPath?: string;
}

// ---------------------------------------------------------------------------
// Domain pattern sets (documented inline per bead spec)
// ---------------------------------------------------------------------------

/**
 * Security domain: paths that touch authentication, cryptography, secrets,
 * input-validation, network/HTTP handlers, or dependency manifests.
 * A changed file matching ANY of these patterns triggers the security reviewer.
 */
const SECURITY_PATTERNS: RegExp[] = [
  // Authentication / authorization / session
  /auth/i,
  /login/i,
  /session/i,
  /oauth/i,
  /\bpermission/i,
  /\baccess[-_]?control/i,
  /credential/i,
  /password/i,
  /\btoken/i,
  /\bsecret/i,
  // Cryptography
  /\bcrypto/i,
  /\bcipher/i,
  /\bhash/i,
  /encrypt/i,
  /decrypt/i,
  /\bsign\b/i,
  // Input parsing / validation / sanitization
  /sanitiz/i,
  /\bescape\b/i,
  /\bxss\b/i,
  /\bcsrf\b/i,
  /sql.*inject/i,
  // Network / HTTP handlers / webhooks
  /\bwebhook/i,
  /\bmiddleware/i,
  // Dependency manifests (supply-chain)
  /package\.json$/,
  /bun\.lock$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /requirements\.txt$/,
  /Cargo\.toml$/,
  /go\.mod$/,
  /Gemfile$/,
];

/**
 * Performance domain: paths in known hot-paths (database layer, WebSocket
 * server, dashboard routes, and explicit performance-indicator segments).
 * Narrower than the security list — only include on strong signal.
 */
const PERFORMANCE_PATTERNS: RegExp[] = [
  // Database layer — every query matters at scale
  /src\/lib\/database\//,
  /src\/lib\/cloister\/in-flight/i,
  // Dashboard server routes — hot I/O path
  /src\/dashboard\/server\/routes\//,
  // WebSocket real-time paths
  /src\/dashboard\/server\/ws-/,
  // Explicit performance segments in path
  /\bperf\b/i,
  /\bcache\b/i,
  /\bthrottle\b/i,
  /\bbatch\b/i,
  /\bpool\b/i,
  /\bqueue\b/i,
  /\bindex\b/i,
];

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

/**
 * Compute which reviewer sub-roles should run in a re-review cycle.
 *
 * @param scope            Configured re-review scope ('all' | 'changed' | 'blockers')
 * @param changedFiles     File paths changed since the last reviewed commit
 * @param priorVerdicts    Per-sub-role verdicts from the previous review cycle
 * @returns                Ordered list of sub-roles to run (subset of REVIEW_SUB_ROLES)
 */
export function reviewersToRerun(
  scope: ReReviewScope,
  changedFiles: string[],
  priorVerdicts: Partial<Record<ReviewSubRole, PriorVerdict>>,
): ReviewSubRole[] {
  const ALL: readonly ReviewSubRole[] = ['security', 'correctness', 'performance', 'requirements'];

  if (scope === 'all') {
    return [...ALL];
  }

  if (scope === 'blockers') {
    return ALL.filter(sr => priorVerdicts[sr]?.status === 'blocked');
  }

  // scope === 'changed': quality-first domain mapping
  const inScope = new Set<ReviewSubRole>();

  // Correctness and requirements always re-run on any change.
  if (changedFiles.length > 0) {
    inScope.add('correctness');
    inScope.add('requirements');
  }

  // NFR-1: any reviewer that blocked last cycle is always included.
  for (const sr of ALL) {
    if (priorVerdicts[sr]?.status === 'blocked') {
      inScope.add(sr);
    }
  }

  // Security: include if any changed file matches a security-sensitive pattern.
  if (!inScope.has('security')) {
    if (changedFiles.some(f => SECURITY_PATTERNS.some(p => p.test(f)))) {
      inScope.add('security');
    }
  }

  // Performance: include if any changed file matches the hot-path allowlist.
  if (!inScope.has('performance')) {
    if (changedFiles.some(f => PERFORMANCE_PATTERNS.some(p => p.test(f)))) {
      inScope.add('performance');
    }
  }

  // Preserve canonical ordering.
  return ALL.filter(sr => inScope.has(sr));
}
