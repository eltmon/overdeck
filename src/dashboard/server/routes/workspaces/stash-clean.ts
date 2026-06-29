/**
 * Stash-clean route module — extracted from routes/workspaces.ts (B / wave 2, seam 2).
 *
 * Git-stash recovery + corrupted-workspace clean endpoints:
 *   GET    /api/workspaces/:issueId/stashes
 *   POST   /api/workspaces/:issueId/stashes/:stashRef/recover
 *   DELETE /api/workspaces/:issueId/stashes/:stashRef
 *   GET    /api/workspaces/:issueId/clean/preview
 *   POST   /api/workspaces/:issueId/clean
 *
 * Shared singletons (project path, trusted-origin guard, readJsonBody,
 * spawnPanCommand) stay owned by ../workspaces.js and are imported here.
 */

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { parseIssueIdSync, extractPrefixSync } from '../../../../lib/issue-id.js';
import {
  listStashes,
  isSalvageableStash,
  createRecoveryBranchFromStash,
  dropStash,
} from '../../../../lib/stashes.js';
import { getContainersReferencingWorkspacePath } from '../../../../lib/workspace-manager.js';
import { DEVCONTAINER_DIRNAME } from '../../../../lib/workspace/devcontainer-renderer.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getProjectPath,
  requireTrustedMutationOrigin,
  readJsonBody,
  spawnPanCommand,
  getWorkspaceInfoForIssue,
} from '../workspaces.js';

const execAsync = promisify(exec);

function resolveWorkspacePath(issueId: string): string | null {
  const info = getWorkspaceInfoForIssue(issueId);
  if (info.isRemote || !info.localPath) return null;
  return info.localPath;
}
const getWorkspaceStashesRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/stashes',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const workspacePath = resolveWorkspacePath(issueId);

    if (!workspacePath || !existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
    }

    const stashes = yield* listStashes(workspacePath);
    const salvageableStashes = stashes
      .filter(isSalvageableStash)
      .filter((entry) => entry.issueId === issueId.toUpperCase())
      .map((entry) => ({
        ref: entry.ref,
        stackRef: entry.stackRef,
        issueId: entry.issueId,
        message: entry.message,
        shortDescription: entry.shortDescription,
        createdAt: entry.createdAt?.toISOString(),
      }));

    return jsonResponse({ salvageableStashes });
  }))
);
const postWorkspaceRecoverStashRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/stashes/:stashRef/recover',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedMutationOrigin(request);
    if (originError) return originError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const stashRef = decodeURIComponent(params['stashRef'] ?? '');
    const workspacePath = resolveWorkspacePath(issueId);

    if (!workspacePath || !existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
    }

    const stashes = yield* listStashes(workspacePath);
    const stash = stashes.find((entry) => entry.ref === stashRef);
    if (!stash || !isSalvageableStash(stash) || stash.issueId !== issueId.toUpperCase()) {
      return jsonResponse({ error: 'Salvageable stash not found for this workspace' }, { status: 404 });
    }

    const branchName = yield* createRecoveryBranchFromStash(
      workspacePath,
      stash.ref,
      stash.issueId,
      stash.shortDescription,
    );

    return jsonResponse({ success: true, branchName });
  }))
);
const deleteWorkspaceStashRoute = HttpRouter.add(
  'DELETE',
  '/api/workspaces/:issueId/stashes/:stashRef',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedMutationOrigin(request);
    if (originError) return originError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const stashRef = decodeURIComponent(params['stashRef'] ?? '');
    const workspacePath = resolveWorkspacePath(issueId);

    if (!workspacePath || !existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
    }

    const stashes = yield* listStashes(workspacePath);
    const stash = stashes.find((entry) => entry.ref === stashRef);
    if (!stash || !isSalvageableStash(stash) || stash.issueId !== issueId.toUpperCase()) {
      return jsonResponse({ error: 'Salvageable stash not found for this workspace' }, { status: 404 });
    }

    yield* dropStash(workspacePath, stash.ref);
    return jsonResponse({ success: true });
  }))
);
// ─── Route: GET /api/workspaces/:issueId/clean/preview ───────────────────────

const getWorkspaceCleanPreviewRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/clean/preview',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const workspaceName = `feature-${issueLower}`;
    const workspacePath = join(projectPath, 'workspaces', workspaceName);

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace does not exist' }, { status: 404 });
    }

    return yield* Effect.promise(async () => {
        const excludeDirs = [
          'node_modules', 'target', 'dist', 'build', '.git', '__pycache__', '.cache', '.next', 'coverage',
        ];
        const excludePattern = excludeDirs.map(d => `-name "${d}" -prune`).join(' -o ');
        const findCmd = `find "${workspacePath}" \\( ${excludePattern} \\) -o -type f -print 2>/dev/null | head -500`;
        const { stdout: filesOutput } = await execAsync(findCmd, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
        });
        const files = filesOutput.trim()
          ? filesOutput.trim().split('\n').map(f => f.replace(workspacePath + '/', ''))
          : [];

        let totalSize = '0';
        try {
          const duCmd = `du -sh "${workspacePath}" --exclude=node_modules --exclude=target --exclude=dist --exclude=.git 2>/dev/null | cut -f1`;
          const { stdout: sizeOutput } = await execAsync(duCmd, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
          });
          totalSize = sizeOutput.trim() || '0';
        } catch {
          totalSize = 'unknown';
        }

        const codeFiles = files.filter(f =>
          /\.(ts|tsx|js|jsx|java|py|rs|go|rb|php|cs|swift|kt)$/.test(f)
        );
        const configFiles = files.filter(
          f => /\.(json|yaml|yml|toml|xml|env|md)$/.test(f) || f.includes('config')
        );
        const otherFiles = files.filter(f => !codeFiles.includes(f) && !configFiles.includes(f));

        let diffAnalysis: {
          modifiedFiles: string[];
          newFiles: string[];
          unchangedFiles: string[];
          comparedAgainst: string;
          error?: string;
        } = { modifiedFiles: [], newFiles: [], unchangedFiles: [], comparedAgainst: 'main' };

        try {
          const subrepos: { prefix: string; gitRoot: string }[] = [];
          const possibleSubrepos = ['fe', 'api', 'frontend', 'backend', 'web', 'server'];
          for (const subdir of possibleSubrepos) {
            const subdirPath = join(workspacePath, subdir);
            if (existsSync(join(subdirPath, '.git'))) {
              subrepos.push({ prefix: subdir + '/', gitRoot: subdirPath });
            }
          }

          let mainGitRoot: string | null = null;
          const possibleRoots = [projectPath, join(projectPath, '..'), workspacePath];
          for (const root of possibleRoots) {
            if (existsSync(join(root, '.git'))) {
              mainGitRoot = root;
              break;
            }
          }

          const filesToCheck = codeFiles.slice(0, 100);
          const reposUsed: string[] = [];

          for (const file of filesToCheck) {
            const workspaceFilePath = join(workspacePath, file);
            let gitRoot: string | null = null;
            let relativePath = file;

            for (const { prefix, gitRoot: subGitRoot } of subrepos) {
              if (file.startsWith(prefix)) {
                gitRoot = subGitRoot;
                relativePath = file.slice(prefix.length);
                if (!reposUsed.includes(prefix)) reposUsed.push(prefix);
                break;
              }
            }

            if (!gitRoot && mainGitRoot) {
              gitRoot = mainGitRoot;
              if (!reposUsed.includes('main')) reposUsed.push('main');
            }

            if (!gitRoot) {
              diffAnalysis.newFiles.push(file);
              continue;
            }

            try {
              const branchName = `feature/${issueLower}`;
              let compareRef = 'main';
              try {
                await execAsync(`git rev-parse --verify ${branchName} 2>/dev/null`, {
                  cwd: gitRoot,
                  encoding: 'utf-8',
                  maxBuffer: 10 * 1024 * 1024,
                });
                compareRef = branchName;
              } catch {
                try {
                  await execAsync(`git rev-parse --verify main 2>/dev/null`, {
                    cwd: gitRoot,
                    encoding: 'utf-8',
                    maxBuffer: 10 * 1024 * 1024,
                  });
                } catch {
                  compareRef = 'master';
                }
              }

              const { stdout: gitContent } = await execAsync(
                `git show ${compareRef}:${relativePath} 2>/dev/null`,
                { cwd: gitRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
              );
              const workspaceContent = await readFile(workspaceFilePath, 'utf-8');
              if (gitContent === workspaceContent) {
                diffAnalysis.unchangedFiles.push(file);
              } else {
                diffAnalysis.modifiedFiles.push(file);
              }
            } catch {
              diffAnalysis.newFiles.push(file);
            }
          }

          diffAnalysis.comparedAgainst =
            reposUsed.length > 0 ? `${reposUsed.join(', ')} repos (main branch)` : 'main';

          if (subrepos.length === 0 && !mainGitRoot) {
            diffAnalysis.error = 'Could not find git repository to compare against';
          }
        } catch (diffError: unknown) {
          diffAnalysis.error = `Diff analysis failed: ${diffError instanceof Error ? diffError.message : String(diffError)}`;
        }

    return jsonResponse({
      workspacePath,
      totalSize,
      fileCount: files.length,
      codeFiles: codeFiles.slice(0, 50),
      configFiles: configFiles.slice(0, 30),
      otherFiles: otherFiles.slice(0, 20),
      hasMore: files.length > 100,
      backupPath: join(
        projectPath,
        'workspaces',
        `.backup-${workspaceName}-${Date.now()}`
      ),
      diffAnalysis,
    });
    });
  }))
);
// ─── Route: POST /api/workspaces/:issueId/clean ───────────────────────────────

const postWorkspaceCleanRoute = HttpRouter.add(
  'POST',
  '/api/workspaces/:issueId/clean',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const body = yield* readJsonBody;
    const { createBackup } = body as { createBackup?: boolean };

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();
    const workspaceName = `feature-${issueLower}`;
    const workspacePath = join(projectPath, 'workspaces', workspaceName);

    if (!existsSync(workspacePath)) {
      return jsonResponse({ error: 'Workspace does not exist' }, { status: 404 });
    }

    let backupPath: string | null = null;

    if (createBackup) {
      backupPath = join(
        projectPath,
        'workspaces',
        `.backup-${workspaceName}-${Date.now()}`
      );
      console.log(`Creating backup: ${workspacePath} -> ${backupPath}`);
      yield* Effect.promise(() => execAsync(
        `rsync -a --quiet --exclude=node_modules --exclude=target --exclude=dist --exclude=.git --exclude=__pycache__ --exclude=.cache --exclude=.next --exclude=coverage "${workspacePath}/" "${backupPath}/"`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      ));
    }

    console.log(`Removing corrupted workspace: ${workspacePath}`);

    // Guard: never delete workspace while containers still reference its compose path
    const orphanedContainers = yield* Effect.promise(() =>
      getContainersReferencingWorkspacePath(workspacePath)
    );
    if (orphanedContainers.length > 0) {
      return jsonResponse(
        {
          error: `Cannot remove workspace: ${orphanedContainers.length} Docker container(s) still reference compose paths in ${DEVCONTAINER_DIRNAME}/. Stop the containers first.`,
        },
        { status: 409 },
      );
    }

    try {
      yield* Effect.promise(() => execAsync(`rm -rf "${workspacePath}"`, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      }));
    } catch {
      console.log('Regular rm failed, using Docker to clean up root-owned files...');
      yield* Effect.promise(() => execAsync(
        `docker run --rm -v "${workspacePath}:/cleanup" alpine sh -c "rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?* 2>/dev/null || true"`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      ));
      yield* Effect.promise(() => execAsync(`rmdir "${workspacePath}"`, { encoding: 'utf-8' }));
    }

    const activityId = spawnPanCommand(
      ['workspace', 'create', issueId],
      `Recreate workspace for ${issueId}`,
      projectPath
    );

    return jsonResponse({
      success: true,
      message: createBackup
        ? `Backed up to ${backupPath} and recreating workspace for ${issueId}`
        : `Cleaned corrupted workspace and recreating for ${issueId}`,
      activityId,
      projectPath,
      backupPath,
    });
  }))
);

export const stashCleanRouteLayer = Layer.mergeAll(
  getWorkspaceStashesRoute,
  postWorkspaceRecoverStashRoute,
  deleteWorkspaceStashRoute,
  getWorkspaceCleanPreviewRoute,
  postWorkspaceCleanRoute,
);

export default stashCleanRouteLayer;
