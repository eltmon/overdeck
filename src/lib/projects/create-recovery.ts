/**
 * Read-only reconciliation for a project-creation operation whose outcome is not
 * known (PAN-3836 WI-1.5, FR-17).
 *
 * This exists because of one specific way the first implementation lied. When a
 * job poll 404'd, the client looked for a project with the expected key, found
 * one, and called it success — so a *pre-existing, unrelated* project named the
 * same thing, or a registration that never finished its setup, both reported as
 * "created". A key is not proof. Identity is the canonical path, and for a clone
 * also the remote it actually points at.
 *
 * Every function here only reads. It never registers, clones, repairs, or
 * deletes: the caller decides what to do with the verdict, and an unproven
 * outcome stays unproven rather than being rounded up to success.
 *
 * The honest limit, documented because the UI has to say it out loud: jobs live
 * in memory, so after a dashboard restart nothing can prove whether a clone that
 * was mid-flight died or finished. If the canonical state does not show a
 * complete or partial result, the answer is `unknown` — not "retry", which could
 * start a second clone into a directory the first one is still writing.
 */

import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { getProjectSync } from '../projects.js';
import { getMainWorkspace } from '../workspaces/resolver.js';
import { canonicalizeProjectPath } from './create.js';
import { parseRepoUrl } from './repo-url.js';
import { promptGuardGitEnv } from './create.js';

const execFileAsync = promisify(execFile);
const GIT_METADATA_TIMEOUT_MS = 5_000;

/** What the caller believed it was creating, as far as it can be trusted. */
export interface ProjectRecoveryExpectation {
  key: string;
  /** The destination the operation owned. Compared canonically, never by string. */
  expectedPath: string;
  mode: 'clone' | 'existing' | 'new';
  /**
   * For a clone, the repository the result must actually point at. A browser
   * supplied it, so it is a claim to verify — never an identity to write.
   */
  expectedRepoSlug?: string | null;
}

export type ProjectRecoveryOutcome =
  /** Registered at the expected path, with a usable main workspace. */
  | { status: 'completed'; key: string; path: string; mainWorkspaceId: string }
  /** Registered at the expected path, but setup did not finish. Repairable. */
  | { status: 'needs-setup'; key: string; path: string; reason: string }
  /** Something is registered under this key, but it is not what was expected. */
  | { status: 'conflict'; key: string; path: string; reason: string }
  /** Nothing proves success or failure. Do not retry automatically. */
  | { status: 'unknown'; reason: string };

/**
 * Decide what actually happened to a creation operation, from canonical state.
 *
 * Deliberately conservative: every branch that cannot *prove* completion returns
 * `conflict` or `unknown`, because the cost of a wrong "completed" is an
 * operator who thinks they have a working project and does not.
 */
export async function resolveProjectCreateRecovery(
  expectation: ProjectRecoveryExpectation,
): Promise<ProjectRecoveryOutcome> {
  const config = getProjectSync(expectation.key);
  if (!config) {
    return {
      status: 'unknown',
      reason: `No project is registered under '${expectation.key}' on this server.`,
    };
  }

  const registeredPath = await canonicalizeProjectPath(config.path);
  const expectedPath = await canonicalizeProjectPath(expectation.expectedPath);

  if (registeredPath !== expectedPath) {
    // The key matched and the path did not. This is exactly the case the old
    // key-only check reported as success.
    return {
      status: 'conflict',
      key: expectation.key,
      path: registeredPath,
      reason: `Project '${expectation.key}' is registered at ${registeredPath}, not ${expectedPath}.`,
    };
  }

  const onDisk = await directoryExists(registeredPath);
  if (!onDisk) {
    return {
      status: 'conflict',
      key: expectation.key,
      path: registeredPath,
      reason: `Project '${expectation.key}' is registered at ${registeredPath}, but no directory is there.`,
    };
  }

  // For a clone, the registered folder must actually be the repository asked
  // for. A same-named folder that happens to exist is not the clone's output.
  if (expectation.mode === 'clone' && expectation.expectedRepoSlug) {
    const actualSlug = await readOriginSlug(registeredPath);
    if (!actualSlug) {
      return {
        status: 'conflict',
        key: expectation.key,
        path: registeredPath,
        reason: `The folder at ${registeredPath} has no Git origin, so it is not the repository that was requested.`,
      };
    }
    if (actualSlug !== expectation.expectedRepoSlug) {
      return {
        status: 'conflict',
        key: expectation.key,
        path: registeredPath,
        reason: `The folder at ${registeredPath} points at ${actualSlug}, not ${expectation.expectedRepoSlug}.`,
      };
    }
  }

  const main = getMainWorkspace(expectation.key);
  if (!main) {
    return {
      status: 'needs-setup',
      key: expectation.key,
      path: registeredPath,
      reason: 'The project is registered but its main workspace was never created.',
    };
  }

  const mainPath = await canonicalizeProjectPath(main.path);
  if (mainPath !== registeredPath) {
    return {
      status: 'conflict',
      key: expectation.key,
      path: registeredPath,
      reason: `The main workspace for '${expectation.key}' points at ${mainPath}, not ${registeredPath}.`,
    };
  }

  return {
    status: 'completed',
    key: expectation.key,
    path: registeredPath,
    mainWorkspaceId: main.id,
  };
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** The `owner/repo` the folder's origin points at, or null when unreadable. */
async function readOriginSlug(dir: string): Promise<string | null> {
  try {
    await stat(join(dir, '.git'));
  } catch {
    return null;
  }
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: dir,
      timeout: GIT_METADATA_TIMEOUT_MS,
      env: promptGuardGitEnv(),
    });
    return parseRepoUrl(stdout.trim())?.slug ?? null;
  } catch {
    return null;
  }
}
