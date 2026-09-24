/**
 * Runtime Architecture (Claude Code only)
 *
 * Export the Claude runtime adapter and provide a registry
 */

export * from './interface.js';
export { createClaudeAdapterSync } from './claude.js';

import { Effect } from 'effect';
import { createClaudeAdapterSync } from './claude.js';

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants of the registry/install helpers. Sync and
// promise variants above remain the canonical API for existing callers.
