/**
 * Workspace-data route module — extracted from routes/workspaces.ts (B / wave 2, seam 1).
 *
 * Read-only workspace query + plan/UAT + TLDR endpoints:
 *   GET    /api/workspace-stack-health
 *   GET    /api/workspaces/:issueId
 *   POST   /api/workspaces
 *   GET    /api/workspaces/:issueId/plan
 *   GET    /api/workspaces/:issueId/uat-context
 *   PATCH  /api/workspaces/:issueId/plan/inspection-policy
 *   GET    /api/workspaces/:issueId/tldr
 *
 * Shared singletons (project path, workspace info, container status, pending ops,
 * review reconciliation, readJsonBody, spawnPanCommand, requireTrustedMutationOrigin)
 * stay owned by ../workspaces.js and are imported here.
 */

import { exec, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { parseIssueIdSync, extractPrefixSync } from '../../../../lib/issue-id.js';
import {
  resolveProjectFromIssueSync,
  getProjectSync,
  findProjectByTeamSync,
} from '../../../../lib/projects.js';
import { loadWorkspaceMetadataSync } from '../../../../lib/remote/workspace-metadata.js';
import {
  collectDockerContainerLifecycleSnapshot,
  getWorkspaceStackHealth,
} from '../../../../lib/workspace/stack-health.js';
import { listSessionNames, capturePane } from '../../../../lib/tmux.js';
import { getActiveSessionModelSync } from '../../../../lib/cost-parsers/jsonl-parser.js';
import { getReviewStatusSync } from '../../../../lib/review-status.js';
import { listStashes, isSalvageableStash } from '../../../../lib/stashes.js';
import { findPlan, isPlanningComplete, readPlan } from '../../../../lib/vbrief/io.js';
import { getCostsForIssueSync } from '../../../../lib/costs/index.js';
import { resolveIssueHeadlineCost } from '../../services/issue-cost-resolver.js';
import { getCachedRunningAgents } from '../../services/running-agents-cache.js';
import { PAN_CONTINUE_FILENAME, PAN_DIRNAME } from '../../../../lib/pan-dir/types.js';
import { getWorkspacePathForIssue } from '../../workspace-paths.js';
import { criticalPath, actionableDoc } from '../../../../lib/vbrief/dag.js';
import { findVBriefByIssue, readVBriefDocument } from '../../../../lib/vbrief/vbrief-index.js';
import { VBRIEF_INSPECTION_POLICIES } from '../../../../lib/vbrief/types.js';
import type { VBriefDocument, VBriefInspectionPolicy } from '../../../../lib/vbrief/types.js';
import { getChangedFiles, getDiffBase, getDiffStat } from '../../../../lib/cloister/review-context.js';
import type { ChangedFile } from '../../../../lib/cloister/review-context.js';
import { getTldrDaemonServiceSync } from '../../../../lib/tldr-daemon.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  getProjectPath,
  getWorkspaceInfoForIssue,
  getContainerStatusAsync,
  getPendingOperation,
  readJsonBody,
  spawnPanCommand,
  requireTrustedMutationOrigin,
} from '../workspaces.js';
import { reconcileGitHubMergeStatus } from './merge-ops.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function getWorkspaceLocation(issueId: string): 'local' | 'remote' | undefined {
  try {
    const meta = loadWorkspaceMetadataSync(issueId);
    if (meta?.location) return meta.location as 'local' | 'remote';
  } catch { /* non-fatal */ }
  return undefined;
}
async function getGitStatusAsync(workspacePath: string): Promise<{
  branch: string;
  uncommittedFiles: number;
  latestCommit: string;
} | null> {
  try {
    const [branchResult, statusResult, logResult] = await Promise.all([
      execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, encoding: 'utf-8' }),
      execAsync('git status --porcelain', { cwd: workspacePath, encoding: 'utf-8' }),
      execAsync('git log -1 --format="%s"', { cwd: workspacePath, encoding: 'utf-8' }),
    ]);
    return {
      branch: branchResult.stdout.trim(),
      uncommittedFiles: statusResult.stdout.trim() ? statusResult.stdout.trim().split('\n').length : 0,
      latestCommit: logResult.stdout.trim(),
    };
  } catch {
    return null;
  }
}
async function getRepoGitStatusAsync(workspacePath: string): Promise<{
  ahead: number;
  behind: number;
  hasOrigin: boolean;
} | null> {
  try {
    const { stdout: remoteOut } = await execAsync('git remote -v', { cwd: workspacePath, encoding: 'utf-8' });
    if (!remoteOut.includes('origin')) return { ahead: 0, behind: 0, hasOrigin: false };
    const { stdout: revlistOut } = await execAsync(
      'git rev-list --left-right --count HEAD...origin/HEAD 2>/dev/null || echo "0\t0"',
      { cwd: workspacePath, encoding: 'utf-8' }
    );
    const parts = revlistOut.trim().split('\t');
    return {
      ahead: parseInt(parts[0] || '0', 10),
      behind: parseInt(parts[1] || '0', 10),
      hasOrigin: true,
    };
  } catch {
    return null;
  }
}
async function getMrUrlAsync(issueId: string, workspacePath: string): Promise<string | null> {
  try {
    const issueLower = issueId.toLowerCase();
    const branchName = `feature/${issueLower}`;
    const { stdout } = await execFileAsync('gh', ['pr', 'view', branchName, '--json', 'url', '--jq', '.url'], { cwd: workspacePath, encoding: 'utf-8' });
    const url = stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}
async function getIndexStats(workspacePath: string): Promise<{
  fileCount?: number;
  indexAge?: string;
  edgeCount?: number;
}> {
  const tldrPath = join(workspacePath, '.tldr');
  const tldrExists = await access(tldrPath).then(() => true, () => false);
  if (!tldrExists) return {};
  try {
    let indexAge: string | undefined;
    const langPath = join(tldrPath, 'languages.json');
    const langContent = await readFile(langPath, 'utf-8').catch(() => null);
    if (langContent) {
      const langData = JSON.parse(langContent);
      if (langData.timestamp) {
        const ageMs = Date.now() - langData.timestamp * 1000;
        const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
        indexAge =
          ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
      }
    }
    if (!indexAge) {
      const stats = await stat(tldrPath);
      const ageMs = Date.now() - stats.mtimeMs;
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      indexAge =
        ageHours === 0 ? 'now' : ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
    }
    let fileCount: number | undefined;
    let edgeCount: number | undefined;
    const cgPath = join(tldrPath, 'cache', 'call_graph.json');
    const cgContent = await readFile(cgPath, 'utf-8').catch(() => null);
    if (cgContent) {
      const cg = JSON.parse(cgContent);
      edgeCount = Array.isArray(cg.edges) ? cg.edges.length : undefined;
      if (Array.isArray(cg.edges)) {
        const files = new Set<string>();
        for (const e of cg.edges) {
          if (e.from_file) files.add(e.from_file);
          if (e.to_file) files.add(e.to_file);
        }
        fileCount = files.size;
      }
    }
    return { fileCount, indexAge, edgeCount };
  } catch (err) {
    console.error(`[getIndexStats] Error for ${workspacePath}:`, err);
    return {};
  }
}
function resolvePlanLocation(projectPath: string, issueId: string): Effect.Effect<{ path: string; lifecycleDir: string; doc: VBriefDocument } | null, unknown> {
  return Effect.gen(function* () {
    const found = yield* findVBriefByIssue(projectPath, issueId);
    if (found) {
      return {
        path: found.path,
        lifecycleDir: found.lifecycleDir,
        doc: yield* readVBriefDocument(found.path),
      };
    }

    const issueLower = issueId.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    const planPath = yield* findPlan(workspacePath);
    if (!planPath) return null;
    return {
      path: planPath,
      lifecycleDir: 'workspace',
      doc: yield* readPlan(planPath),
    };
  });
}

export interface UatContextAcceptanceCriterion {
  id: string;
  title: string;
  status: string;
  itemId: string;
  itemTitle: string;
}

export interface UatContextDeliverable {
  id: string;
  title: string;
  status: string;
  action?: string;
}

export interface UatContextChangedFile {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | 'U';
  additions: number;
  deletions: number;
}

interface UatContextPlanFields {
  acceptanceCriteria: UatContextAcceptanceCriterion[];
  deliverables: UatContextDeliverable[];
  proposal: string | null;
}

interface UatContextGitFields {
  changedFiles: UatContextChangedFile[];
  changedFilesTotal: number;
  changedFilesOmitted: number;
  diffStat: { stat: string; truncated: boolean } | null;
  source: { files: 'git' | 'none' };
}

const MAX_UAT_CONTEXT_CHANGED_FILES = 12;
const MAX_UAT_CONTEXT_DIFF_STAT_LENGTH = 4_000;

export function assembleUatContextPlanFields(doc: VBriefDocument | null): UatContextPlanFields {
  if (!doc) {
    return { acceptanceCriteria: [], deliverables: [], proposal: null };
  }

  const acceptanceCriteria: UatContextAcceptanceCriterion[] = [];
  const deliverables: UatContextDeliverable[] = [];

  for (const item of doc.plan.items ?? []) {
    deliverables.push({
      id: item.id,
      title: item.title,
      status: item.status,
      ...(item.narrative?.Action ? { action: item.narrative.Action } : {}),
    });

    const subItems = item.subItems ?? [];
    if (subItems.length === 0) continue;

    const taggedAcceptanceCriteria = subItems.filter(
      (subItem) => subItem.metadata?.kind === 'acceptance_criterion',
    );
    const selectedSubItems = taggedAcceptanceCriteria.length > 0
      ? taggedAcceptanceCriteria
      : subItems;

    for (const subItem of selectedSubItems) {
      acceptanceCriteria.push({
        id: subItem.id,
        title: subItem.title,
        status: subItem.status,
        itemId: item.id,
        itemTitle: item.title,
      });
    }
  }

  return {
    acceptanceCriteria,
    deliverables,
    proposal: doc.plan.narratives?.Proposal ?? null,
  };
}

export function emptyUatContextGitFields(): UatContextGitFields {
  return {
    changedFiles: [],
    changedFilesTotal: 0,
    changedFilesOmitted: 0,
    diffStat: null,
    source: { files: 'none' },
  };
}

export function assembleUatContextGitFields(
  changedFiles: ChangedFile[],
  diffStat: { stat: string; truncated: boolean },
): UatContextGitFields {
  if (diffStat.stat === 'Unable to compute diff stat') {
    return emptyUatContextGitFields();
  }

  const limitedChangedFiles = changedFiles
    .slice(0, MAX_UAT_CONTEXT_CHANGED_FILES)
    .map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    }));

  const isDiffStatTruncated = diffStat.truncated || diffStat.stat.length > MAX_UAT_CONTEXT_DIFF_STAT_LENGTH;
  const limitedDiffStat = {
    stat: diffStat.stat.slice(0, MAX_UAT_CONTEXT_DIFF_STAT_LENGTH),
    truncated: isDiffStatTruncated,
  };

  return {
    changedFiles: limitedChangedFiles,
    changedFilesTotal: changedFiles.length,
    changedFilesOmitted: Math.max(0, changedFiles.length - limitedChangedFiles.length),
    diffStat: limitedDiffStat,
    source: { files: 'git' },
  };
}

async function readWorkspaceUatChangedFiles(workspacePath: string): Promise<UatContextGitFields> {
  if (!existsSync(workspacePath)) return emptyUatContextGitFields();

  try {
    const base = await getDiffBase(workspacePath);
    const [changedFiles, diffStat] = await Promise.all([
      getChangedFiles(workspacePath, base),
      getDiffStat(workspacePath, base),
    ]);

    return assembleUatContextGitFields(changedFiles, diffStat);
  } catch {
    return emptyUatContextGitFields();
  }
}
// ─── Route: GET /api/workspace-stack-health ──────────────────────────────────

const getWorkspaceStackHealthBatchRoute = HttpRouter.add(
  'GET',
  '/api/workspace-stack-health',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, 'http://localhost');
    const issueIds = Array.from(new Set((url.searchParams.get('issueIds') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)))
      .slice(0, 100);

    const parsedIds = issueIds.map((issueId) => ({ issueId, parsed: parseIssueIdSync(issueId) }));
    const invalid = parsedIds.find(({ parsed }) => !parsed);
    if (invalid) {
      return jsonResponse({ error: `Invalid issue ID: ${invalid.issueId}` }, { status: 400 });
    }

    const workspaceRequests = parsedIds.map(({ parsed }) => {
      const normalizedIssueId = parsed!.raw.toUpperCase();
      const workspaceMetadata = (() => {
        try {
          return loadWorkspaceMetadataSync(normalizedIssueId);
        } catch {
          return null;
        }
      })();
      if (workspaceMetadata?.location === 'remote') {
        return {
          kind: 'response' as const,
          normalizedIssueId,
          response: { exists: true, issueId: normalizedIssueId, location: 'remote', isRemote: true },
        };
      }

      const resolved = resolveProjectFromIssueSync(normalizedIssueId);
      if (!resolved) {
        return {
          kind: 'response' as const,
          normalizedIssueId,
          response: { exists: false, issueId: normalizedIssueId },
        };
      }

      const projectConfig = getProjectSync(resolved.projectKey);
      if (!projectConfig) {
        return {
          kind: 'response' as const,
          normalizedIssueId,
          response: { exists: false, issueId: normalizedIssueId },
        };
      }
      const workspacePath = join(
        resolved.projectPath,
        projectConfig.workspace?.workspaces_dir ?? 'workspaces',
        `feature-${parsed!.normalized}`,
      );
      if (!existsSync(workspacePath)) {
        return {
          kind: 'response' as const,
          normalizedIssueId,
          response: { exists: false, issueId: normalizedIssueId },
        };
      }

      return {
        kind: 'local' as const,
        normalizedIssueId,
        projectConfig,
        projectPath: resolved.projectPath,
        workspacePath,
      };
    });

    const entries = yield* Effect.promise(async () => {
      const containers = workspaceRequests.some((request) =>
        request.kind === 'local' && Boolean(request.projectConfig.workspace?.docker?.compose_template)
      )
        ? await Effect.runPromise(collectDockerContainerLifecycleSnapshot())
        : undefined;

      return Promise.all(workspaceRequests.map(async (request) => {
        if (request.kind === 'response') {
          return [request.normalizedIssueId, request.response] as const;
        }

        const stackHealth = await Effect.runPromise(getWorkspaceStackHealth(request.normalizedIssueId, {
          projectConfig: { ...request.projectConfig, path: request.projectPath },
          workspacePath: request.workspacePath,
          containers,
        }));

        return [request.normalizedIssueId, {
          exists: true,
          issueId: request.normalizedIssueId,
          path: request.workspacePath,
          stackHealth,
          hasDocker: Boolean(request.projectConfig.workspace?.docker?.compose_template),
          location: 'local',
        }] as const;
      }));
    });

    return jsonResponse({ workspaces: Object.fromEntries(entries) });
  })),
);
// ─── Route: GET /api/workspaces/:issueId ─────────────────────────────────────

const getWorkspaceRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const issueLower = issueId.toLowerCase();

    const workspaceInfo = getWorkspaceInfoForIssue(issueId);

        if (workspaceInfo.isRemote && workspaceInfo.vmName) {
          return jsonResponse({
            exists: true,
            issueId,
            isRemote: true,
            vmName: workspaceInfo.vmName,
            remotePath: workspaceInfo.remotePath,
            agentId: workspaceInfo.agentId,
            path: `${workspaceInfo.vmName}:${workspaceInfo.remotePath}`,
            location: 'remote',
            message: `Workspace is on remote Fly machine: ${workspaceInfo.vmName}`,
          });
        }

        const workspaceName = `feature-${issueLower}`;
        const workspacePath = join(projectPath, 'workspaces', workspaceName);

        if (!existsSync(workspacePath)) {
          return jsonResponse({ exists: false, issueId });
        }

        const gitFile = join(workspacePath, '.git');
        const apiGit = join(workspacePath, 'api', '.git');
        const feGit = join(workspacePath, 'fe', '.git');
        const srcGit = join(workspacePath, 'src', '.git');
        const devcontainer = join(workspacePath, '.devcontainer');
        const claudeMd = join(workspacePath, 'CLAUDE.md');

        const hasValidStructure =
          existsSync(gitFile) ||
          existsSync(apiGit) ||
          existsSync(feGit) ||
          existsSync(srcGit) ||
          existsSync(devcontainer) ||
          existsSync(claudeMd);

        if (!hasValidStructure) {
          const location = getWorkspaceLocation(issueId);
          return jsonResponse({
            exists: true,
            corrupted: true,
            issueId,
            path: workspacePath,
            message: 'Workspace exists but is not a valid git worktree or containerized workspace',
            location,
          });
        }

        const projectConfig = findProjectByTeamSync(issuePrefix);
        const dnsDomain = projectConfig?.workspace?.dns?.domain || 'localhost';
        const featureFolder = `feature-${issueLower}`;

        let frontendUrl = `https://${featureFolder}.${dnsDomain}`;
        let apiUrl = `https://api-${featureFolder}.${dnsDomain}`;

        if (projectConfig?.workspace?.dns?.entries) {
          const entries = projectConfig.workspace.dns.entries;
          if (entries[0]) {
            frontendUrl = `https://${entries[0]
              .replace('{{FEATURE_FOLDER}}', featureFolder)
              .replace('{{DOMAIN}}', dnsDomain)}`;
          }
          if (entries[1]) {
            apiUrl = `https://${entries[1]
              .replace('{{FEATURE_FOLDER}}', featureFolder)
              .replace('{{DOMAIN}}', dnsDomain)}`;
          }
        }

        let services: { name: string; url?: string }[] = [];
        const panContinueFile = join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME);
        const workspaceMd = join(workspacePath, 'WORKSPACE.md');
        const dockerCompose = join(workspacePath, 'docker-compose.yml');

        const urlSourceFile = existsSync(panContinueFile)
          ? panContinueFile
          : existsSync(workspaceMd)
          ? workspaceMd
          : null;

        if (urlSourceFile) {
          try {
            const content = yield* Effect.promise(() => readFile(urlSourceFile, 'utf-8'));
            const urlMatches = content.matchAll(/(\w+):\s*(https?:\/\/[^\s\n]+)/gi);
            for (const match of urlMatches) {
              services.push({ name: match[1], url: match[2] });
            }
          } catch {}
        }

        if (services.length === 0) {
          services = [
            { name: 'Frontend', url: frontendUrl },
            { name: 'API', url: apiUrl },
          ];
        }

        const devcontainerPath = join(workspacePath, '.devcontainer');
        let hasDocker =
          existsSync(dockerCompose) ||
          existsSync(join(workspacePath, 'compose.yaml')) ||
          existsSync(join(devcontainerPath, 'docker-compose.yml')) ||
          existsSync(join(devcontainerPath, 'docker-compose.devcontainer.yml')) ||
          existsSync(join(devcontainerPath, 'compose.yaml')) ||
          existsSync(join(devcontainerPath, 'compose.infra.yml')) ||
          existsSync(devcontainerPath);

        // For polyrepo workspaces, also check compose files inside sub-repos
        if (!hasDocker && projectConfig?.workspace?.repos) {
          for (const repo of projectConfig.workspace.repos) {
            const repoPath = join(workspacePath, repo.path);
            if (
              existsSync(join(repoPath, 'docker-compose.yml')) ||
              existsSync(join(repoPath, 'docker-compose.yaml')) ||
              existsSync(join(repoPath, 'compose.yaml'))
            ) {
              hasDocker = true;
              break;
            }
          }
        }

        const canContainerize = false;

        const agentSession = `agent-${issueLower}`;
        const [git, repoGit, containers, stackHealth, mrUrl] = yield* Effect.promise(() => Promise.all([
          getGitStatusAsync(workspacePath),
          getRepoGitStatusAsync(workspacePath),
          hasDocker ? getContainerStatusAsync(issueId, projectPath) : Promise.resolve(null),
          Effect.runPromise(getWorkspaceStackHealth(issueId, { projectConfig, emitTransitionActivity: true })),
          getMrUrlAsync(issueId, workspacePath),
        ]));
        const sessionNames = yield* listSessionNames();
        const paneOutput = yield* capturePane(agentSession, 50).pipe(Effect.orElseSucceed(() => ''));

        let hasAgent = false;
        let agentSessionId: string | null = null;
        let agentModel: string | undefined;
        let agentModelFull: string | undefined;

        if (sessionNames.includes(agentSession)) {
          hasAgent = true;
          agentSessionId = agentSession;

          // Match Anthropic models: [Opus], [Sonnet 4.6], [Haiku 4.5]
          // Also match OpenAI models: [gpt-5.4], [oai@gpt-5.4], [o3], [cx@o3], [o4-mini]
          const modelMatch = paneOutput.match(
            /\[((?:oai|cx|go)?@?(?:gpt-[0-9.]+(?:-mini|-nano|-pro)?|o[1-4](?:-mini)?(?:-high)?|gemini-[0-9.]+(?:-pro|-flash|-lite)?))[^\]]*\]/i
          ) || paneOutput.match(/\[(Opus|Sonnet|Haiku)[^\]]*\]/i);
          agentModel = modelMatch ? modelMatch[1] : undefined;

          const fullModel = getActiveSessionModelSync(workspacePath);
          if (fullModel) agentModelFull = fullModel;
        }

        const pendingOperation = getPendingOperation(issueId);
        const location = getWorkspaceLocation(issueId);
        const reviewStatus = getReviewStatusSync(issueId);

        if (
          pendingOperation?.type === 'merge' &&
          pendingOperation.status === 'failed' &&
          reviewStatus?.mergeStatus !== 'merged'
        ) {
          yield* Effect.promise(() => reconcileGitHubMergeStatus(issueId, reviewStatus));
        }

        const stashes = yield* listStashes(workspacePath);
        const salvageableStashes = stashes
          .filter(isSalvageableStash)
          .filter((entry) => entry.issueId === issueId.toUpperCase());

        const planPath = yield* findPlan(workspacePath);
        const hasPlan = planPath !== null;
        const planningComplete = hasPlan ? yield* isPlanningComplete(workspacePath) : false;
        const hasBeads = planningComplete;

        const issueData = getCostsForIssueSync(issueId);
        const agents = yield* Effect.promise(() => getCachedRunningAgents());
        const resolvedCost = resolveIssueHeadlineCost({
          issueId: issueId,
          aggregateCost: issueData?.totalCost,
          agents,
        });

        return jsonResponse({
          exists: true,
          issueId,
          path: workspacePath,
          frontendUrl,
          apiUrl,
          mrUrl,
          hasAgent,
          agentSessionId,
          agentModel,
          agentModelFull,
          git,
          repoGit,
          services,
          containers,
          stackHealth,
          hasDocker,
          canContainerize,
          pendingOperation,
          location,
          salvageableStashes,
          planningState: {
            hasPlan,
            hasBeads,
            beadsCount: 0,
            planningComplete,
            workspacePath,
          },
          costs: issueData
            ? {
                issueId: issueId.toUpperCase(),
                totalCost: issueData.totalCost,
                resolvedTotalCost: resolvedCost.resolvedTotalCost,
                aggregateCost: resolvedCost.aggregateCost,
                liveCost: resolvedCost.liveCost,
                totalTokens: issueData.inputTokens + issueData.outputTokens + issueData.cacheReadTokens + issueData.cacheWriteTokens,
                inputTokens: issueData.inputTokens,
                outputTokens: issueData.outputTokens,
                cacheReadTokens: issueData.cacheReadTokens,
                cacheWriteTokens: issueData.cacheWriteTokens,
                models: issueData.models,
                providers: issueData.providers,
                byModel: Object.fromEntries(
                  Object.entries(issueData.models).map(([model, stats]: [string, { cost: number; tokens: number }]) => [
                    model,
                    { cost: stats.cost, tokens: stats.tokens },
                  ])
                ),
                sessions: (issueData as unknown as { sessions?: unknown[] }).sessions ?? [],
                byStage: Object.fromEntries(
                  Object.entries(issueData.stages || {}).map(([stage, stats]: [string, { cost: number; tokens: number }]) => [
                    stage,
                    { cost: stats.cost, tokens: stats.tokens },
                  ])
                ),
                budget: issueData.budget,
                budgetWarning: issueData.budgetWarning,
                lastUpdated: issueData.lastUpdated,
              }
            : {
                issueId: issueId.toUpperCase(),
                totalCost: 0,
                resolvedTotalCost: resolvedCost.resolvedTotalCost,
                aggregateCost: resolvedCost.aggregateCost,
                liveCost: resolvedCost.liveCost,
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                models: {},
                providers: {},
                byModel: {},
                sessions: [],
                byStage: {},
                budget: undefined,
                budgetWarning: false,
              },
        });
  }))
);
// ─── Route: POST /api/workspaces ─────────────────────────────────────────────

const postWorkspacesRoute = HttpRouter.add(
  'POST',
  '/api/workspaces',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody;
    const { issueId, projectId } = body as { issueId?: string; projectId?: string };

    if (!issueId) {
      return jsonResponse({ error: 'issueId required' }, { status: 400 });
    }

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(projectId, issuePrefix);
    const activityId = spawnPanCommand(
      ['workspace', 'create', issueId],
      `Create workspace for ${issueId}`,
      projectPath
    );
    return jsonResponse({
      success: true,
      message: `Creating workspace for ${issueId}`,
      activityId,
      projectPath,
    });
  }))
);
const getWorkspacePlanRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/plan',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }
    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);

    const location = yield* resolvePlanLocation(projectPath, issueId);
    if (!location) {
      return jsonResponse(
        { error: 'No vBRIEF plan found for this workspace' },
        { status: 404 }
      );
    }

    const cp = criticalPath(actionableDoc(location.doc));
    return jsonResponse({ ...location.doc, criticalPath: cp, lifecycleDir: location.lifecycleDir });
  }))
);
const getWorkspaceUatContextRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/uat-context',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    const parsed = parseIssueIdSync(issueId);
    if (!parsed) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const issuePrefix = parsed.prefix ?? extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const { parsedIssueId, workspacePath } = getWorkspacePathForIssue(projectPath, issueId);

    const location = yield* Effect.promise(() =>
      Effect.runPromise(resolvePlanLocation(projectPath, parsedIssueId)).catch(() => null)
    );
    const planFields = assembleUatContextPlanFields(location?.doc ?? null);
    const gitFields = yield* Effect.promise(() => readWorkspaceUatChangedFiles(workspacePath));

    return jsonResponse({
      issueId: parsedIssueId,
      ...planFields,
      changedFiles: gitFields.changedFiles,
      changedFilesTotal: gitFields.changedFilesTotal,
      changedFilesOmitted: gitFields.changedFilesOmitted,
      diffStat: gitFields.diffStat,
      source: {
        plan: location ? 'vbrief' : 'none',
        files: gitFields.source.files,
      },
    });
  }))
);
const patchWorkspacePlanInspectionPolicyRoute = HttpRouter.add(
  'PATCH',
  '/api/workspaces/:issueId/plan/inspection-policy',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedMutationOrigin(request);
    if (originError) return originError;

    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    const body = yield* readJsonBody;
    const policy = (body as { inspectionPolicy?: unknown }).inspectionPolicy;
    if (!VBRIEF_INSPECTION_POLICIES.includes(policy as VBriefInspectionPolicy)) {
      return jsonResponse({ error: 'Invalid inspection policy' }, { status: 400 });
    }

    const issuePrefix = extractPrefixSync(issueId) ?? issueId.split('-')[0];
    const projectPath = getProjectPath(undefined, issuePrefix);
    const location = yield* resolvePlanLocation(projectPath, issueId);
    if (!location) {
      return jsonResponse(
        { error: 'No vBRIEF plan found for this workspace' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();
    const updated: VBriefDocument = {
      ...location.doc,
      vBRIEFInfo: {
        ...location.doc.vBRIEFInfo,
        inspectionPolicy: policy as VBriefInspectionPolicy,
        updated: now,
      },
      plan: {
        ...location.doc.plan,
        updated: now,
      },
    };

    yield* Effect.promise(() => writeFile(location.path, JSON.stringify(updated, null, 2) + '\n', 'utf-8'));
    const cp = criticalPath(updated);
    return jsonResponse({ ...updated, criticalPath: cp, lifecycleDir: location.lifecycleDir });
  }))
);
// ─── Route: GET /api/workspaces/:issueId/tldr ─────────────────────────────────

const getWorkspaceTldrRoute = HttpRouter.add(
  'GET',
  '/api/workspaces/:issueId/tldr',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const issueId = params['issueId'] ?? '';
    if (!parseIssueIdSync(issueId)) {
      return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
    }

    return yield* Effect.promise(async () => {
        const projectRoot = process.cwd();
        const workspacePath = join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
        const venvPath = join(workspacePath, '.venv');

        if (!existsSync(workspacePath)) {
          return jsonResponse({ error: 'Workspace not found' }, { status: 404 });
        }

        if (!existsSync(venvPath)) {
          return jsonResponse({
            available: false,
            reason: 'No .venv found in workspace',
          });
        }

        const service = getTldrDaemonServiceSync(workspacePath, venvPath);
        const status = await service.getStatus();
        const { fileCount, indexAge, edgeCount } = await getIndexStats(workspacePath);

        return jsonResponse({
          available: true,
          running: status.running,
          pid: status.pid,
          healthy: status.healthy,
          workspacePath,
          fileCount,
          indexAge,
          edgeCount,
        });
    })
  }))
);

export const workspaceDataRouteLayer = Layer.mergeAll(
  getWorkspaceStackHealthBatchRoute,
  getWorkspaceRoute,
  postWorkspacesRoute,
  getWorkspacePlanRoute,
  getWorkspaceUatContextRoute,
  patchWorkspacePlanInspectionPolicyRoute,
  getWorkspaceTldrRoute,
);

export default workspaceDataRouteLayer;
