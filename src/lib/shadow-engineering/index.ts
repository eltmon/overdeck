/**
 * Shadow Engineering Module
 *
 * Provides AI-powered observation and assistance for teams transitioning
 * to AI-assisted development. Instead of replacing human workflows,
 * Shadow Engineering watches, learns, and assists.
 *
 * Components:
 * - Monitoring Agent: Analyzes artifacts, produces INFERENCE.md
 * - Observer Agent: Watches PRs, comments with observations
 */

export { gatherArtifacts, generateMonitoringPrompt, generateBasicInference, updateInferenceDocumentSync, readInferenceDocumentSync } from './monitoring-agent.js';
export type { MonitoringAgentConfig, InferenceDocument } from './monitoring-agent.js';

export { pollPRs, generateObservation, postPRComment, generateObserverPrompt, runObserverCycle } from './observer-agent.js';
export type { ObserverAgentConfig, PRInfo } from './observer-agent.js';

import { existsSync } from 'fs';
import { join } from 'path';

import { PAN_CONTEXT_FILENAME, PAN_DIRNAME } from '../pan-dir/index.js';

/**
 * Check if a workspace is in Shadow Engineering mode
 */
export function isShadowWorkspace(workspacePath: string): boolean {
  return existsSync(join(workspacePath, PAN_DIRNAME, 'INFERENCE.md'))
    || existsSync(join(workspacePath, PAN_DIRNAME, PAN_CONTEXT_FILENAME));
}
