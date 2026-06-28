import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  ContextLayerSaveRequest,
  ContextPreviewRequest,
  type ContextEditableLayerRecord,
  type ContextLayerDraft,
  type ContextLayerSaveResponse,
  type ContextLayerTarget,
  type ContextLayersResponse,
  type ContextPreviewDiagnostic,
  type ContextPreviewResponse,
  type ContextProjectSummary,
  type ContextSyncResponse,
  type ContextSyncTarget,
  type ContextWorkspaceSummary,
  type Harness,
} from '@overdeck/contracts';
import { Effect, Layer, Schema } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { renderForHarness, validateTemplate } from '../../../lib/context-layers/harness.js';
import {
  globalContextFile as defaultGlobalContextFile,
  projectContextFile,
  workspaceContextFile,
  codexGlobalContextFile,
} from '../../../lib/context-layers/layers.js';
import { hasManagedRegion, userContentOutsideRegion } from '../../../lib/context-layers/render.js';
import { CLAUDE_DIR, getOverdeckHome, isDevMode, SYNC_SOURCES } from '../../../lib/paths.js';
import { listProjects, type ProjectConfig } from '../../../lib/projects.js';
import { operatorInterventionEvent } from '../../../lib/operator-interventions.js';
import { getHarnessBehavior } from '../../../lib/runtimes/behavior.js';
import { jsonResponse } from '../http-helpers.js';
import { EventStoreService } from '../services/domain-services.js';
import { httpHandler } from './http-handler.js';

type ProjectEntry = { key: string; config: ProjectConfig };
type ResolvedLayer = ContextEditableLayerRecord & { dir: string };

type ContextCatalog = {
  projects: ProjectEntry[];
  summaries: ContextProjectSummary[];
  workspaces: ContextWorkspaceSummary[];
};

type ContextLayerState = ContextLayersResponse & {
  resolvedLayers: ResolvedLayer[];
};

type ContextSyncCommandResult = {
  stdout: string;
  stderr: string;
};

export type ContextSyncRunner = () => Promise<ContextSyncCommandResult>;

type DashboardContextSyncResponse = ContextSyncResponse & {
  ok: boolean;
  status: 'synced' | 'failed';
  error?: string;
};

type RuleScope = 'universal' | 'dev';

const PREVIEW_HARNESSES: readonly Harness[] = ['claude-code', 'ohmypi', 'codex'];
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const execFileAsync = promisify(execFile);
const decodePreviewRequest = Schema.decodeUnknownSync(ContextPreviewRequest);
const decodeSaveRequest = Schema.decodeUnknownSync(ContextLayerSaveRequest);

function globalContextFile(overdeckHome = getOverdeckHome()): string {
  return overdeckHome === getOverdeckHome()
    ? defaultGlobalContextFile()
    : join(overdeckHome, 'context', 'global.md');
}

function contextDirForFile(file: string): string {
  return dirname(file);
}

function pathWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function assertPathInside(root: string, candidate: string): void {
  if (!pathWithin(root, candidate)) {
    throw new Error(`Path escapes allowed root: ${candidate}`);
  }
}

async function readOptionalFile(path: string): Promise<{ exists: boolean; content: string }> {
  try {
    return { exists: true, content: await readFile(path, 'utf-8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, content: '' };
    throw error;
  }
}

function workspaceRootForProject(project: ProjectConfig): string {
  const configured = project.workspace?.workspaces_dir ?? 'workspaces';
  return isAbsolute(configured) ? resolve(configured) : resolve(project.path, configured);
}

function summarizeProject({ key, config }: ProjectEntry): ContextProjectSummary {
  return {
    projectKey: key,
    name: config.name,
    path: resolve(config.path),
    ...(config.issue_prefix ? { issuePrefix: config.issue_prefix } : {}),
    ...(config.tracker ? { tracker: config.tracker } : {}),
    workspaceRoot: workspaceRootForProject(config),
  };
}

function workspaceIssueId(name: string): string | undefined {
  const match = /^feature-([a-z]+)-(\d+)(?:-.+)?$/i.exec(name);
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : undefined;
}

function workspaceBranch(name: string): string | undefined {
  return name.startsWith('feature-') ? name : undefined;
}

async function discoverWorkspacesForProject(projectKey: string, config: ProjectConfig): Promise<ContextWorkspaceSummary[]> {
  const root = workspaceRootForProject(config);
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const path = resolve(root, entry.name);
      assertPathInside(root, path);
      return {
        projectKey,
        path,
        name: entry.name,
        ...(workspaceIssueId(entry.name) ? { issueId: workspaceIssueId(entry.name)! } : {}),
        ...(workspaceBranch(entry.name) ? { branch: workspaceBranch(entry.name)! } : {}),
      } satisfies ContextWorkspaceSummary;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function buildContextCatalog(projects: ProjectEntry[]): Promise<ContextCatalog> {
  const normalizedProjects = projects
    .map((project) => ({
      key: project.key,
      config: { ...project.config, path: resolve(project.config.path) },
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const workspaceGroups = await Promise.all(
    normalizedProjects.map((project) => discoverWorkspacesForProject(project.key, project.config)),
  );
  return {
    projects: normalizedProjects,
    summaries: normalizedProjects.map(summarizeProject).sort((a, b) => a.projectKey.localeCompare(b.projectKey)),
    workspaces: workspaceGroups.flat().sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function targetKey(target: ContextLayerTarget): string {
  switch (target.kind) {
    case 'global':
      return 'global';
    case 'project':
      return `project:${target.projectKey}`;
    case 'workspace':
      return `workspace:${target.projectKey}:${resolve(target.workspacePath)}`;
  }
}

function targetForLayer(layer: ContextEditableLayerRecord): ContextLayerTarget {
  switch (layer.kind) {
    case 'global':
      return { kind: 'global' };
    case 'project':
      return { kind: 'project', projectKey: layer.projectKey };
    case 'workspace':
      return { kind: 'workspace', projectKey: layer.projectKey, workspacePath: resolve(layer.workspacePath) };
  }
}

function sameTarget(a: ContextLayerTarget, b: ContextLayerTarget): boolean {
  return targetKey(a) === targetKey(b);
}

function selectedProjectKey(target: ContextLayerTarget): string | undefined {
  if (target.kind === 'project' || target.kind === 'workspace') return target.projectKey;
  return undefined;
}

function selectedWorkspacePath(target: ContextLayerTarget): string | undefined {
  return target.kind === 'workspace' ? resolve(target.workspacePath) : undefined;
}

function applicableLayers(state: ContextLayerState, selectedLayer: ContextLayerTarget): ResolvedLayer[] {
  const projectKey = selectedProjectKey(selectedLayer);
  const workspacePath = selectedWorkspacePath(selectedLayer);
  return state.resolvedLayers.filter((layer) => {
    if (layer.kind === 'global') return true;
    if (layer.kind === 'project') return layer.projectKey === projectKey;
    return layer.projectKey === projectKey && resolve(layer.workspacePath) === workspacePath;
  });
}

async function layerRecord(
  file: string,
  base: Omit<ContextEditableLayerRecord, 'file' | 'exists' | 'content' | 'editable'>,
): Promise<ResolvedLayer> {
  const { exists, content } = await readOptionalFile(file);
  return {
    ...base,
    file,
    exists,
    content,
    editable: true,
    dir: contextDirForFile(file),
  } as ResolvedLayer;
}

/**
 * Describe one injection target so the dashboard can show the user where a
 * managed region lands and whether their own content is preserved there.
 */
async function describeSyncTarget(
  harness: Harness,
  layerKind: 'global' | 'project',
  projectKey: string | undefined,
  label: string,
  path: string,
): Promise<ContextSyncTarget> {
  const { exists, content } = await readOptionalFile(path);
  return {
    harness,
    layerKind,
    ...(projectKey ? { projectKey } : {}),
    label,
    path,
    exists,
    hasManagedRegion: exists ? hasManagedRegion(content) : false,
    hasUserContent: exists ? userContentOutsideRegion(content).length > 0 : false,
  };
}

/**
 * The files `pan sync` writes Overdeck-managed regions into: the global
 * Claude Code CLAUDE.md, and — for each project with a `project.md` — that
 * project's CLAUDE.md (Claude Code) and AGENTS.md (Pi). The Pi global layer is
 * a Overdeck-owned file, not a user file, so it is not listed as a target.
 */
async function buildSyncTargets(projects: ProjectEntry[]): Promise<ContextSyncTarget[]> {
  const targets: ContextSyncTarget[] = [
    await describeSyncTarget('claude-code', 'global', undefined, 'Claude Code · global', join(CLAUDE_DIR, 'CLAUDE.md')),
    await describeSyncTarget('codex', 'global', undefined, 'Codex · global (codex-global.md)', codexGlobalContextFile()),
  ];

  for (const { key, config } of projects) {
    const projectMd = await readOptionalFile(projectContextFile(config.path));
    if (!projectMd.exists) continue; // no project.md → sync leaves this project's files alone
    targets.push(
      await describeSyncTarget('claude-code', 'project', key, `${config.name} · CLAUDE.md`, join(config.path, 'CLAUDE.md')),
    );
    targets.push(
      await describeSyncTarget('pi', 'project', key, `${config.name} · AGENTS.md`, join(config.path, 'AGENTS.md')),
    );
  }

  return targets;
}

export async function buildContextLayerState(
  projects: ProjectEntry[],
  overdeckHome = getOverdeckHome(),
): Promise<ContextLayerState> {
  const catalog = await buildContextCatalog(projects);
  const resolvedLayers: ResolvedLayer[] = [
    await layerRecord(globalContextFile(overdeckHome), { kind: 'global' }),
  ];

  for (const project of catalog.projects) {
    resolvedLayers.push(await layerRecord(projectContextFile(project.config.path), {
      kind: 'project',
      projectKey: project.key,
    }));
  }

  for (const workspace of catalog.workspaces) {
    resolvedLayers.push(await layerRecord(workspaceContextFile(workspace.path), {
      kind: 'workspace',
      projectKey: workspace.projectKey,
      workspacePath: workspace.path,
    }));
  }

  return {
    operation: 'load',
    projects: catalog.summaries,
    workspaces: catalog.workspaces,
    layers: resolvedLayers.map(({ dir: _dir, ...layer }) => layer),
    targets: await buildSyncTargets(catalog.projects),
    resolvedLayers,
  };
}

export async function loadContextLayers(
  projects: ProjectEntry[],
  overdeckHome = getOverdeckHome(),
): Promise<ContextLayersResponse> {
  const { resolvedLayers: _resolvedLayers, ...response } = await buildContextLayerState(projects, overdeckHome);
  return response;
}

export const buildContextLayersResponse = loadContextLayers;

function findLayer(state: ContextLayerState, target: ContextLayerTarget): ResolvedLayer | null {
  return state.resolvedLayers.find((layer) => sameTarget(targetForLayer(layer), target)) ?? null;
}

function requireLayer(state: ContextLayerState, target: ContextLayerTarget): ResolvedLayer {
  const layer = findLayer(state, target);
  if (!layer) throw new Error(`Context layer is not registered: ${targetKey(target)}`);
  return layer;
}

function draftContentByTarget(state: ContextLayerState, drafts: readonly ContextLayerDraft[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const draft of drafts) {
    requireLayer(state, draft.target);
    map.set(targetKey(draft.target), draft.content);
  }
  return map;
}

function contentForLayer(layer: ResolvedLayer, drafts: ReadonlyMap<string, string>): string {
  return drafts.get(targetKey(targetForLayer(layer))) ?? layer.content;
}

function parseRule(raw: string): { scope: RuleScope; body: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { scope: 'universal', body: raw.trim() };
  const scopeLine = match[1].split(/\r?\n/).find((line) => /^\s*scope\s*:/.test(line));
  const scope = scopeLine?.split(':')[1]?.trim().replace(/["']/g, '');
  return {
    scope: scope === 'dev' ? 'dev' : 'universal',
    body: raw.slice(match[0].length).trim(),
  };
}

async function renderBundledRulesAsync(harness: Harness): Promise<string> {
  const includeDev = isDevMode();
  const entries = await readdir(SYNC_SOURCES.rules, { withFileTypes: true }).catch(() => []);
  const sections = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const file = join(SYNC_SOURCES.rules, entry.name);
        assertPathInside(SYNC_SOURCES.rules, file);
        const rule = parseRule(await readFile(file, 'utf-8'));
        if (!includeDev && rule.scope === 'dev') return '';
        return renderForHarness(rule.body, harness).trim();
      }),
  );
  const rendered = sections.filter((section) => section.length > 0);
  return rendered.length > 0 ? `## Overdeck Engineering Rules\n\n${rendered.join('\n\n')}` : '';
}

function renderLayerSections(layers: readonly ResolvedLayer[], drafts: ReadonlyMap<string, string>, harness: Harness): string {
  return layers
    .map((layer) => {
      const rendered = renderForHarness(contentForLayer(layer, drafts), harness).trim();
      const label = layer.kind === 'global'
        ? 'Global layer'
        : layer.kind === 'project'
          ? `Project layer: ${layer.projectKey}`
          : `Workspace layer: ${layer.workspacePath}`;
      return `## ${label}\n\n${rendered || '_No context in this layer._'}`;
    })
    .join('\n\n---\n\n');
}

async function previewForHarness(layers: readonly ResolvedLayer[], drafts: ReadonlyMap<string, string>, harness: Harness): Promise<string> {
  const title = getHarnessBehavior(harness).displayName;
  return [
    `# Overdeck injected context preview (${title})`,
    renderLayerSections(layers, drafts, harness),
    await renderBundledRulesAsync(harness),
  ].filter((section) => section.trim().length > 0).join('\n\n---\n\n');
}

function fullPromptPreview(previews: Record<Harness, string>): string {
  return [
    '# Full injected prompt preview',
    '',
    'Private harness base prompt: Unavailable. Overdeck cannot inspect or reproduce the private base prompt owned by the harness provider.',
    '',
    '## Overdeck-controlled Claude Code bundle',
    '',
    previews['claude-code'] || '(no rendered context)',
    '',
    '## Overdeck-controlled oh-my-pi bundle',
    '',
    previews.ohmypi || '(no rendered context)',
    '',
    '## Overdeck-controlled Codex bundle',
    '',
    previews.codex || '(no rendered context)',
    '',
    '## Runtime-only sections',
    '',
    '- Memory retrieval: injected at agent spawn when enabled; unavailable in this layer editor preview.',
    '- Issue briefing and vBRIEF excerpts: injected per agent run; unavailable until a specific issue/session is selected.',
    '- Status and tool output: produced during the live session; not part of static context layers.',
  ].join('\n');
}

function diagnosticsForLayers(layers: readonly ResolvedLayer[], drafts: ReadonlyMap<string, string>): ContextPreviewDiagnostic[] {
  const diagnostics: ContextPreviewDiagnostic[] = [];
  for (const layer of layers) {
    const target = targetForLayer(layer);
    for (const issue of validateTemplate(contentForLayer(layer, drafts)).issues) {
      diagnostics.push({
        level: issue.severity,
        message: issue.message,
        layer: target,
      });
    }
  }
  return diagnostics;
}

export async function previewContextLayers(
  projects: ProjectEntry[],
  request: ContextPreviewRequest,
  overdeckHome?: string,
): Promise<ContextPreviewResponse>;
export async function previewContextLayers(
  projects: ProjectEntry[],
  selectedLayer: ContextLayerTarget,
  drafts: readonly ContextLayerDraft[],
  overdeckHome?: string,
): Promise<ContextPreviewResponse>;
export async function previewContextLayers(
  projects: ProjectEntry[],
  requestOrSelectedLayer: ContextPreviewRequest | ContextLayerTarget,
  maybeDraftsOrOverdeckHome?: readonly ContextLayerDraft[] | string,
  maybeOverdeckHome = getOverdeckHome(),
): Promise<ContextPreviewResponse> {
  const request = 'operation' in requestOrSelectedLayer
    ? requestOrSelectedLayer
    : {
        operation: 'preview' as const,
        selectedLayer: requestOrSelectedLayer,
        drafts: Array.isArray(maybeDraftsOrOverdeckHome) ? maybeDraftsOrOverdeckHome : [],
      };
  const overdeckHome = typeof maybeDraftsOrOverdeckHome === 'string'
    ? maybeDraftsOrOverdeckHome
    : maybeOverdeckHome;
  const state = await buildContextLayerState(projects, overdeckHome);
  requireLayer(state, request.selectedLayer);
  const drafts = draftContentByTarget(state, request.drafts);
  const layers = applicableLayers(state, request.selectedLayer);
  const previews = {} as Record<Harness, string>;
  for (const harness of PREVIEW_HARNESSES) {
    previews[harness] = await previewForHarness(layers, drafts, harness);
  }
  return {
    operation: 'preview',
    previews: {
      'claude-code': previews['claude-code'],
      ohmypi: previews.ohmypi,
      codex: previews.codex,
      fullPrompt: fullPromptPreview(previews),
    },
    diagnostics: diagnosticsForLayers(layers, drafts),
  };
}

export async function saveContextLayer(
  projects: ProjectEntry[],
  request: ContextLayerSaveRequest,
  overdeckHome?: string,
): Promise<ContextLayerSaveResponse>;
export async function saveContextLayer(
  projects: ProjectEntry[],
  target: ContextLayerTarget,
  content: string,
  overdeckHome?: string,
): Promise<ContextLayerSaveResponse>;
export async function saveContextLayer(
  projects: ProjectEntry[],
  requestOrTarget: ContextLayerSaveRequest | ContextLayerTarget,
  maybeContentOrOverdeckHome?: string,
  maybeOverdeckHome = getOverdeckHome(),
): Promise<ContextLayerSaveResponse> {
  const request = 'operation' in requestOrTarget
    ? requestOrTarget
    : {
        operation: 'save' as const,
        target: requestOrTarget,
        content: maybeContentOrOverdeckHome ?? '',
      };
  const overdeckHome = 'operation' in requestOrTarget
    ? maybeContentOrOverdeckHome ?? maybeOverdeckHome
    : maybeOverdeckHome;
  const state = await buildContextLayerState(projects, overdeckHome);
  const layer = requireLayer(state, request.target);
  if (!pathWithin(layer.dir, layer.file)) {
    throw new Error(`Context layer path escapes its directory: ${layer.file}`);
  }
  await mkdir(layer.dir, { recursive: true });
  // Atomic write: write to a temp file in the same directory, then rename over
  // the target. rename(2) is atomic on POSIX, so a concurrent reader (or a
  // crash mid-write) never sees a partially written context file.
  const tempFile = join(layer.dir, `.${randomUUID()}.tmp`);
  try {
    await writeFile(tempFile, request.content, 'utf-8');
    await rename(tempFile, layer.file);
  } catch (err) {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw err;
  }
  const savedLayer = await layerRecord(
    layer.file,
    targetForLayer(layer) as Omit<ContextEditableLayerRecord, 'file' | 'exists' | 'content' | 'editable'>,
  );
  const { dir: _dir, ...responseLayer } = savedLayer;
  return {
    operation: 'save',
    layer: responseLayer,
    savedAt: new Date().toISOString(),
  };
}

async function runPanContextSync(): Promise<ContextSyncCommandResult> {
  const { stdout, stderr } = await execFileAsync('pan', ['context', 'sync'], {
    encoding: 'utf-8',
  });
  return { stdout, stderr };
}

function syncExitCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

function syncOutput(error: unknown, key: 'stdout' | 'stderr'): string {
  if (!error || typeof error !== 'object') return '';
  const value = (error as Record<typeof key, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export async function syncContextLayers(
  runner: ContextSyncRunner = runPanContextSync,
): Promise<DashboardContextSyncResponse> {
  const syncedAt = new Date().toISOString();
  try {
    const { stdout, stderr } = await runner();
    return {
      operation: 'sync',
      success: true,
      ok: true,
      status: 'synced',
      stdout,
      stderr,
      syncedAt,
    };
  } catch (error) {
    return {
      operation: 'sync',
      success: false,
      ok: false,
      status: 'failed',
      stdout: syncOutput(error, 'stdout'),
      stderr: syncOutput(error, 'stderr'),
      error: error instanceof Error ? error.message : 'pan context sync failed',
      exitCode: syncExitCode(error),
      syncedAt,
    };
  }
}

function issueIdFromWorkspacePath(workspacePath: string): string | null {
  const match = /(?:^|[^a-z0-9])([a-z]+-\d+)(?:[^a-z0-9]|$)/i.exec(workspacePath);
  return match ? match[1]!.toUpperCase() : null;
}

function readJsonBody() {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const text = yield* request.text;
    return text ? JSON.parse(text) as unknown : {};
  });
}

function loadProjectsForRoute() {
  return listProjects().pipe(
    Effect.mapError((error) => new Error(error instanceof Error ? error.message : String(error))),
  );
}

const getContextLayersRoute = HttpRouter.add(
  'GET',
  '/api/context/layers',
  httpHandler(Effect.gen(function* () {
    const projects = yield* loadProjectsForRoute();
    return jsonResponse(yield* Effect.promise(() => loadContextLayers(projects)));
  })),
);

const postContextPreviewRoute = HttpRouter.add(
  'POST',
  '/api/context/preview',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody();
    const parsed = yield* Effect.try({
      try: () => decodePreviewRequest(body),
      catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
    });
    const projects = yield* loadProjectsForRoute();
    return jsonResponse(yield* Effect.promise(() => previewContextLayers(projects, parsed)));
  })),
);

const putContextLayerRoute = HttpRouter.add(
  'PUT',
  '/api/context/layers',
  httpHandler(Effect.gen(function* () {
    const body = yield* readJsonBody();
    const parsed = yield* Effect.try({
      try: () => decodeSaveRequest(body),
      catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
    });
    const projects = yield* loadProjectsForRoute();
    const eventStore = yield* EventStoreService;
    const response = yield* Effect.promise(() => saveContextLayer(projects, parsed));
    if (parsed.target.kind === 'workspace') {
      const issueId = issueIdFromWorkspacePath(parsed.target.workspacePath);
      if (issueId) {
        yield* eventStore.appendAsync(operatorInterventionEvent({
          issueId,
          kind: 'manual_edit',
          source: 'dashboard:context-layer-save',
        }));
      }
    }
    return jsonResponse(response);
  })),
);

const postContextSyncRoute = HttpRouter.add(
  'POST',
  '/api/context/sync',
  httpHandler(Effect.gen(function* () {
    const response = yield* Effect.promise(() => syncContextLayers());
    return jsonResponse(response, { status: response.ok ? 200 : 500 });
  })),
);

export const contextRouteLayer = Layer.mergeAll(
  getContextLayersRoute,
  postContextPreviewRoute,
  putContextLayerRoute,
  postContextSyncRoute,
);
