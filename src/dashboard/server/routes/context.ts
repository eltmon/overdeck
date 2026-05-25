import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { Harness } from '@panctl/contracts';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { renderForHarness, validateTemplate } from '../../../lib/context-layers/harness.js';
import {
  globalContextFile,
  projectContextFile,
  workspaceContextFile,
  type ContextLayerKind,
} from '../../../lib/context-layers/layers.js';
import { listProjects, type ProjectConfig } from '../../../lib/projects.js';
import { isDevMode, SYNC_SOURCES } from '../../../lib/paths.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

type ContextLayerTarget =
  | { kind: 'global' }
  | { kind: 'project'; projectKey: string }
  | { kind: 'workspace'; projectKey: string; workspacePath: string };

type ContextProjectSummary = {
  projectKey: string;
  name: string;
  path: string;
  issuePrefix?: string;
  tracker?: ProjectConfig['tracker'];
  workspaceRoot?: string;
};

type ContextWorkspaceSummary = {
  projectKey: string;
  path: string;
  name: string;
  issueId?: string;
  branch?: string;
};

type ContextEditableLayerRecord = {
  kind: ContextLayerKind;
  file: string;
  exists: boolean;
  content: string;
  editable: boolean;
  projectKey?: string;
  workspacePath?: string;
};

type ContextLayerDraft = {
  target: ContextLayerTarget;
  content: string;
};

type ContextLayersResponse = {
  operation: 'load';
  projects: ContextProjectSummary[];
  workspaces: ContextWorkspaceSummary[];
  layers: ContextEditableLayerRecord[];
};

type ContextPreviewDiagnostic = {
  level: 'info' | 'warning' | 'error';
  message: string;
  layer?: ContextLayerTarget;
};

type ContextPreviewResponse = {
  operation: 'preview';
  previews: Record<Harness | 'fullPrompt', string>;
  diagnostics: ContextPreviewDiagnostic[];
};

type ContextLayerSaveResponse = {
  operation: 'save';
  layer: ContextEditableLayerRecord;
  savedAt: string;
};

type ProjectEntry = { key: string; config: ProjectConfig };

type ContextCatalog = {
  projects: ProjectEntry[];
  summaries: ContextProjectSummary[];
  workspaces: ContextWorkspaceSummary[];
};

const PREVIEW_HARNESSES: readonly Harness[] = ['claude-code', 'pi'];
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

type RuleScope = 'universal' | 'dev';

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function readOptionalFile(path: string): Promise<{ exists: boolean; content: string }> {
  try {
    return { exists: true, content: await readFile(path, 'utf-8') };
  } catch (error) {
    if (isMissingFileError(error)) return { exists: false, content: '' };
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function assertPathInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.includes(`..${sep}`))) return;
  throw new Error(`Path escapes allowed root: ${candidate}`);
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
    issuePrefix: config.issue_prefix,
    tracker: config.tracker,
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
  if (!(await pathExists(root))) return [];

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = resolve(root, entry.name);
      assertPathInside(root, path);
      return {
        projectKey,
        path,
        name: entry.name,
        issueId: workspaceIssueId(entry.name),
        branch: workspaceBranch(entry.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildContextCatalog(projects: ProjectEntry[]): Promise<ContextCatalog> {
  const summaries = projects.map(summarizeProject);
  const workspaceGroups = await Promise.all(
    projects.map((project) => discoverWorkspacesForProject(project.key, project.config)),
  );
  return {
    projects,
    summaries,
    workspaces: workspaceGroups.flat(),
  };
}

async function layerRecord(
  kind: ContextLayerKind,
  file: string,
  extras: { projectKey?: string; workspacePath?: string } = {},
): Promise<ContextEditableLayerRecord> {
  const { exists, content } = await readOptionalFile(file);
  return { kind, file, exists, content, editable: true, ...extras };
}

export async function buildContextLayersResponse(projects: ProjectEntry[]): Promise<ContextLayersResponse> {
  const catalog = await buildContextCatalog(projects);
  const layers: ContextEditableLayerRecord[] = [
    await layerRecord('global', globalContextFile()),
  ];

  for (const project of catalog.projects) {
    layers.push(await layerRecord('project', projectContextFile(project.config.path), { projectKey: project.key }));
  }

  for (const workspace of catalog.workspaces) {
    layers.push(await layerRecord('workspace', workspaceContextFile(workspace.path), {
      projectKey: workspace.projectKey,
      workspacePath: workspace.path,
    }));
  }

  return {
    operation: 'load',
    projects: catalog.summaries,
    workspaces: catalog.workspaces,
    layers,
  };
}

function findProject(projects: ProjectEntry[], projectKey: string): ProjectEntry {
  const project = projects.find((entry) => entry.key === projectKey);
  if (!project) throw new Error(`Unknown project: ${projectKey}`);
  return project;
}

async function resolveLayerFile(
  target: ContextLayerTarget,
  projects: ProjectEntry[],
  catalog?: ContextCatalog,
): Promise<{ file: string; kind: ContextLayerKind; projectKey?: string; workspacePath?: string }> {
  if (target.kind === 'global') {
    return { kind: 'global', file: globalContextFile() };
  }

  const project = findProject(projects, target.projectKey);
  const projectRoot = resolve(project.config.path);

  if (target.kind === 'project') {
    const file = projectContextFile(projectRoot);
    assertPathInside(projectRoot, file);
    return { kind: 'project', file, projectKey: target.projectKey };
  }

  const resolvedWorkspacePath = resolve(target.workspacePath);
  const contextCatalog = catalog ?? await buildContextCatalog(projects);
  const allowedWorkspace = contextCatalog.workspaces.find(
    (workspace) => workspace.projectKey === target.projectKey && resolve(workspace.path) === resolvedWorkspacePath,
  );
  if (!allowedWorkspace) throw new Error(`Unknown workspace for project ${target.projectKey}: ${target.workspacePath}`);

  const file = workspaceContextFile(resolvedWorkspacePath);
  assertPathInside(resolvedWorkspacePath, file);
  return { kind: 'workspace', file, projectKey: target.projectKey, workspacePath: resolvedWorkspacePath };
}

function parseTarget(value: unknown): ContextLayerTarget {
  if (!value || typeof value !== 'object') throw new Error('target must be an object');
  const source = value as Record<string, unknown>;
  if (source['kind'] === 'global') return { kind: 'global' };
  if (source['kind'] === 'project' && typeof source['projectKey'] === 'string') {
    return { kind: 'project', projectKey: source['projectKey'] };
  }
  if (
    source['kind'] === 'workspace' &&
    typeof source['projectKey'] === 'string' &&
    typeof source['workspacePath'] === 'string'
  ) {
    return { kind: 'workspace', projectKey: source['projectKey'], workspacePath: source['workspacePath'] };
  }
  throw new Error('target must specify a valid global, project, or workspace layer');
}

function parseDrafts(value: unknown): ContextLayerDraft[] {
  if (!Array.isArray(value)) return [];
  return value.map((draft) => {
    if (!draft || typeof draft !== 'object') throw new Error('drafts must contain objects');
    const source = draft as Record<string, unknown>;
    if (typeof source['content'] !== 'string') throw new Error('draft content must be a string');
    return { target: parseTarget(source['target']), content: source['content'] };
  });
}

function parseJsonBody(text: string): Record<string, unknown> {
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON body must be an object');
  return parsed as Record<string, unknown>;
}

function layerKey(target: ContextLayerTarget): string {
  if (target.kind === 'global') return 'global';
  if (target.kind === 'project') return `project:${target.projectKey}`;
  return `workspace:${target.projectKey}:${resolve(target.workspacePath)}`;
}

async function resolveLayerContent(
  target: ContextLayerTarget,
  projects: ProjectEntry[],
  catalog: ContextCatalog,
  draftByKey: ReadonlyMap<string, string>,
): Promise<{ target: ContextLayerTarget; file: string; content: string; exists: boolean }> {
  const resolved = await resolveLayerFile(target, projects, catalog);
  const normalizedTarget = resolved.kind === 'workspace'
    ? { kind: 'workspace' as const, projectKey: resolved.projectKey!, workspacePath: resolved.workspacePath! }
    : resolved.kind === 'project'
      ? { kind: 'project' as const, projectKey: resolved.projectKey! }
      : { kind: 'global' as const };
  const draft = draftByKey.get(layerKey(normalizedTarget));
  if (draft !== undefined) return { target: normalizedTarget, file: resolved.file, content: draft, exists: await pathExists(resolved.file) };
  const { exists, content } = await readOptionalFile(resolved.file);
  return { target: normalizedTarget, file: resolved.file, content, exists };
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
  return rendered.length > 0 ? `## Panopticon Engineering Rules\n\n${rendered.join('\n\n')}` : '';
}

function formatRenderedLayers(
  harness: Harness,
  layers: Array<{ title: string; content: string }>,
  bundledRules: string,
): string {
  const renderedLayers = layers
    .map((layer) => {
      const rendered = renderForHarness(layer.content, harness).trim();
      return rendered ? `## ${layer.title}\n\n${rendered}` : '';
    })
    .filter((section) => section.length > 0);

  return [...renderedLayers, bundledRules].filter((section) => section.trim().length > 0).join('\n\n---\n\n');
}

function formatFullPrompt(previews: Record<Harness, string>): string {
  return [
    '# Full injected prompt preview',
    '',
    'Private harness base prompt: unavailable. Panopticon cannot inspect or reproduce the private base prompt owned by the harness provider.',
    '',
    '## Panopticon-controlled Claude Code bundle',
    '',
    previews['claude-code'] || '(no rendered context)',
    '',
    '## Panopticon-controlled Pi bundle',
    '',
    previews.pi || '(no rendered context)',
    '',
    '## Runtime-only sections',
    '',
    '- Memory retrieval: injected at agent spawn when enabled; unavailable in this layer editor preview.',
    '- Issue briefing and vBRIEF excerpts: injected per agent run; unavailable until a specific issue/session is selected.',
    '- Status and tool output: produced during the live session; not part of static context layers.',
  ].join('\n');
}

export async function previewContextLayers(
  projects: ProjectEntry[],
  selectedLayer: ContextLayerTarget,
  drafts: ContextLayerDraft[],
): Promise<ContextPreviewResponse> {
  const catalog = await buildContextCatalog(projects);
  const draftByKey = new Map<string, string>();
  for (const draft of drafts) {
    const resolved = await resolveLayerFile(draft.target, projects, catalog);
    const normalizedTarget = resolved.kind === 'workspace'
      ? { kind: 'workspace' as const, projectKey: resolved.projectKey!, workspacePath: resolved.workspacePath! }
      : draft.target;
    draftByKey.set(layerKey(normalizedTarget), draft.content);
  }

  const resolvedSelected = await resolveLayerFile(selectedLayer, projects, catalog);
  const selectedTarget = resolvedSelected.kind === 'workspace'
    ? { kind: 'workspace' as const, projectKey: resolvedSelected.projectKey!, workspacePath: resolvedSelected.workspacePath! }
    : selectedLayer;

  const targets: Array<{ title: string; target: ContextLayerTarget }> = [{ title: 'Global context layer', target: { kind: 'global' } }];
  if (selectedTarget.kind === 'project') {
    targets.push({ title: `Project context layer (${selectedTarget.projectKey})`, target: selectedTarget });
  } else if (selectedTarget.kind === 'workspace') {
    targets.push({ title: `Project context layer (${selectedTarget.projectKey})`, target: { kind: 'project', projectKey: selectedTarget.projectKey } });
    targets.push({ title: `Workspace context layer (${selectedTarget.workspacePath})`, target: selectedTarget });
  }

  const layerContents = await Promise.all(
    targets.map(async ({ title, target }) => ({ title, ...(await resolveLayerContent(target, projects, catalog, draftByKey)) })),
  );

  const diagnostics: ContextPreviewDiagnostic[] = [];
  for (const layer of layerContents) {
    const validation = validateTemplate(layer.content);
    diagnostics.push(...validation.issues.map((issue) => ({
      level: issue.severity,
      message: issue.message,
      layer: layer.target,
    })));
  }

  const previews = {} as Record<Harness, string>;
  for (const harness of PREVIEW_HARNESSES) {
    previews[harness] = formatRenderedLayers(
      harness,
      layerContents.map((layer) => ({ title: layer.title, content: layer.content })),
      await renderBundledRulesAsync(harness),
    );
  }

  return {
    operation: 'preview',
    previews: {
      'claude-code': previews['claude-code'],
      pi: previews.pi,
      fullPrompt: formatFullPrompt(previews),
    },
    diagnostics,
  };
}

export async function saveContextLayer(
  projects: ProjectEntry[],
  target: ContextLayerTarget,
  content: string,
): Promise<ContextLayerSaveResponse> {
  const resolved = await resolveLayerFile(target, projects);
  await mkdir(dirname(resolved.file), { recursive: true });
  await writeFile(resolved.file, content, 'utf-8');
  return {
    operation: 'save',
    layer: await layerRecord(resolved.kind, resolved.file, {
      projectKey: resolved.projectKey,
      workspacePath: resolved.workspacePath,
    }),
    savedAt: new Date().toISOString(),
  };
}

const getContextLayersRoute = HttpRouter.add(
  'GET',
  '/api/context/layers',
  httpHandler(Effect.gen(function* () {
    const projects = yield* listProjects();
    return jsonResponse(yield* Effect.promise(() => buildContextLayersResponse(projects)));
  })),
);

const postContextPreviewRoute = HttpRouter.add(
  'POST',
  '/api/context/preview',
  httpHandler(Effect.gen(function* () {
    const projects = yield* listProjects();
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = parseJsonBody(yield* request.text);
    const selectedLayer = parseTarget(body['selectedLayer']);
    const drafts = parseDrafts(body['drafts']);
    return jsonResponse(yield* Effect.promise(() => previewContextLayers(projects, selectedLayer, drafts)));
  })),
);

const putContextLayerRoute = HttpRouter.add(
  'PUT',
  '/api/context/layers',
  httpHandler(Effect.gen(function* () {
    const projects = yield* listProjects();
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = parseJsonBody(yield* request.text);
    const target = parseTarget(body['target']);
    const content = body['content'];
    if (typeof content !== 'string') throw new Error('content must be a string');
    return jsonResponse(yield* Effect.promise(() => saveContextLayer(projects, target, content)));
  })),
);

export const contextRouteLayer = Layer.mergeAll(
  getContextLayersRoute,
  postContextPreviewRoute,
  putContextLayerRoute,
);
