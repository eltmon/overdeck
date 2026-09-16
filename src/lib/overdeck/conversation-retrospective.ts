/**
 * Pipeline retrospective kickoff renderer and conversation-create handler.
 *
 * Renders `roles/retrospective.md` into a ready-to-send conversation message
 * by substituting the five placeholders the template contract pins
 * (WINDOW_LABEL, WINDOW_START, WINDOW_END, OVERDECK_HOME, PROJECT_LINES),
 * and delegates the actual conversation creation to `handleConversationCreate`
 * via an injected `createConversation` — the single write door. The handler
 * deliberately never forwards `projectKey` or `issueId`: a retrospective is a
 * No-project conversation.
 *
 * Issue: PAN-3841
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { packageRoot, getOverdeckHome } from '../paths.js';
import { listProjectsAsync } from '../projects.js';
import { resolveStateReadHomeAsync } from '../state-read-home.js';

export const RETROSPECTIVE_WINDOWS = {
  '24h': { label: 'last 24 hours', ms: 24 * 60 * 60 * 1000 },
  '7d': { label: 'last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
} as const;
export type RetrospectiveWindow = keyof typeof RETROSPECTIVE_WINDOWS;
export const DEFAULT_RETROSPECTIVE_WINDOW: RetrospectiveWindow = '24h';

export interface RetrospectiveProjectLine {
  key: string;
  path: string;
  stateRoot: string;
  migrated: boolean;
  githubRepo?: string;
}

export function isRetrospectiveWindow(value: unknown): value is RetrospectiveWindow {
  // Use an own-property check instead of `in`: every string key on the
  // Object prototype (constructor / toString / __proto__ / hasOwnProperty…)
  // is a valid `in` lookup, so accepting inherited properties would let a
  // hostile body POST `{ window: 'constructor' }` through validation and
  // crash the renderer on `new Date(NaN)` — variety of malformed shapes.
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(RETROSPECTIVE_WINDOWS, value)
  );
}

export function isRetrospectiveRequestBody(value: unknown): value is Record<string, unknown> {
  // Reject non-object bodies (null, arrays, primitives) before the window
  // lookup. The route's readJsonBody defaults malformed JSON to `{}`, but a
  // caller that POSTs `null` or `"constructor"` would otherwise reach
  // `body.window ?? DEFAULT_RETROSPECTIVE_WINDOW` and create a conversation
  // with the silent default — clearly not what an explicit `null` asked for.
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Same frontmatter regex as runtime-command.ts roleSystemPromptInjectionSync.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function stripFrontmatter(raw: string): string {
  const fm = raw.match(FRONTMATTER_RE);
  return fm ? raw.slice(fm[0].length) : raw;
}

export function formatProjectLines(projects: RetrospectiveProjectLine[]): string {
  if (projects.length === 0) return '- (no registered projects)';
  return projects
    .map(
      (p) =>
        `- ${p.key}: repo ${p.path}; state root ${p.stateRoot} (${
          p.migrated ? 'migrated layout' : 'legacy .pan layout'
        }); github ${p.githubRepo ?? 'none'}`,
    )
    .join('\n');
}

export function renderRetrospectiveKickoff(input: {
  template: string;
  window: RetrospectiveWindow;
  now: Date;
  overdeckHome: string;
  projects: RetrospectiveProjectLine[];
}): string {
  const { label, ms } = RETROSPECTIVE_WINDOWS[input.window];
  const windowEnd = input.now.toISOString();
  const windowStart = new Date(input.now.getTime() - ms).toISOString();
  return stripFrontmatter(input.template)
    .split('{{WINDOW_LABEL}}').join(label)
    .split('{{WINDOW_START}}').join(windowStart)
    .split('{{WINDOW_END}}').join(windowEnd)
    .split('{{OVERDECK_HOME}}').join(input.overdeckHome)
    .split('{{PROJECT_LINES}}').join(formatProjectLines(input.projects))
    .trim();
}

export async function loadRetrospectiveTemplate(
  path = join(packageRoot, 'roles', 'retrospective.md'),
): Promise<string> {
  // No caching: an operator edit to the template takes effect on the next click.
  return readFile(path, 'utf-8');
}

export async function collectRetrospectiveProjects(): Promise<RetrospectiveProjectLine[]> {
  const projects = await listProjectsAsync();
  const lines: RetrospectiveProjectLine[] = [];
  for (const { key, config } of projects) {
    const home = await resolveStateReadHomeAsync(config, key);
    lines.push({
      key,
      path: config.path,
      stateRoot: home.root,
      migrated: home.migrated,
      githubRepo: config.github_repo,
    });
  }
  return lines;
}

export async function handleRetrospectiveConversationCreate(
  body: unknown,
  deps: {
    createConversation: (body: Record<string, unknown>) => Promise<ReturnType<typeof jsonResponse>>;
    loadTemplate?: () => Promise<string>;
    collectProjects?: () => Promise<RetrospectiveProjectLine[]>;
    now?: () => Date;
    overdeckHome?: () => string;
  },
): Promise<ReturnType<typeof jsonResponse>> {
  if (!isRetrospectiveRequestBody(body)) {
    return jsonResponse({ error: 'Invalid body' }, { status: 400 });
  }
  const window = body.window ?? DEFAULT_RETROSPECTIVE_WINDOW;
  if (!isRetrospectiveWindow(window)) {
    return jsonResponse({ error: 'Invalid window' }, { status: 400 });
  }
  const [template, projects] = await Promise.all([
    (deps.loadTemplate ?? loadRetrospectiveTemplate)(),
    (deps.collectProjects ?? collectRetrospectiveProjects)(),
  ]);
  const message = renderRetrospectiveKickoff({
    template,
    window,
    now: (deps.now ?? (() => new Date()))(),
    overdeckHome: (deps.overdeckHome ?? getOverdeckHome)(),
    projects,
  });
  // Forward only the model-routing strings — never projectKey or issueId.
  const model = typeof body.model === 'string' ? body.model : undefined;
  const harness = typeof body.harness === 'string' ? body.harness : undefined;
  const effort = typeof body.effort === 'string' ? body.effort : undefined;
  return deps.createConversation({ message, model, harness, effort });
}
