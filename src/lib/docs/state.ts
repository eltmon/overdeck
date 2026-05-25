import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { dirname, resolve } from 'path';

import { getDefaultDocsConfig, type NormalizedDocsConfig } from '../config-yaml.js';
import { getDocsBudgetStatePath, getDocsDisableStatePath, getDocsTelemetryPath, type DocsPathOverrides } from '../paths.js';

export type DocsDisableScope = 'global' | 'project' | 'session';
export type DocsGateReason = 'docs_disabled' | 'scope_disabled' | 'no_trigger' | 'budget_exhausted' | 'state_error';

export interface DocsHookPayload {
  prompt: string;
  sessionId?: string | null;
  projectPath?: string | null;
}

export interface DocsDisableEntry {
  disabled: boolean;
  updatedAt: string;
  reason?: string;
}

export interface DocsDisableState {
  global?: DocsDisableEntry;
  projects: Record<string, DocsDisableEntry>;
  sessions: Record<string, DocsDisableEntry>;
}

export interface DocsBudgetRecord {
  turn: number;
  injections: Array<{ turn: number; ts: string; tokens: number }>;
}

export interface DocsBudgetState {
  records: Record<string, DocsBudgetRecord>;
}

export interface DocsPromptGateOptions {
  payload: DocsHookPayload;
  config?: Pick<NormalizedDocsConfig, 'enabled' | 'promptInjectionEnabled' | 'trigger' | 'budget'>;
  paths?: DocsPathOverrides;
  now?: Date;
}

export interface DocsPromptGateResult {
  shouldInject: boolean;
  budgetKey: string;
  matched: string[];
  reason?: DocsGateReason;
}

export interface SetDocsDisabledOptions {
  scope: DocsDisableScope;
  disabled: boolean;
  sessionId?: string | null;
  projectPath?: string | null;
  reason?: string;
  paths?: DocsPathOverrides;
  now?: Date;
}

export interface RecordDocsInjectionOptions {
  budgetKey: string;
  tokens: number;
  paths?: DocsPathOverrides;
  now?: Date;
}

export interface DocsTelemetryEntry {
  ts: string;
  event: 'query' | 'injection';
  queryCount: number;
  injectedTokens: number;
  hit: boolean;
  reason?: DocsGateReason;
  matched?: string[];
  budgetKey?: string;
  chunkCount?: number;
}

export interface RecordDocsTelemetryOptions {
  queryCount: number;
  injectedTokens: number;
  hit: boolean;
  reason?: DocsGateReason;
  matched?: string[];
  budgetKey?: string;
  chunkCount?: number;
  paths?: DocsPathOverrides;
  now?: Date;
}

const DEFAULT_DOCS_CONFIG = getDefaultDocsConfig();

export async function evaluateDocsPromptGate(options: DocsPromptGateOptions): Promise<DocsPromptGateResult> {
  const config = mergeGateConfig(options.config);
  const budgetKey = docsBudgetKey(options.payload);
  const matched = matchDocsTrigger(options.payload.prompt, config.trigger);

  try {
    const budgetState = await readDocsBudgetState(options.paths);
    const record = advanceBudgetRecord(budgetState, budgetKey);

    if (!config.enabled || !config.promptInjectionEnabled) {
      await writeDocsBudgetState(budgetState, options.paths);
      return { shouldInject: false, budgetKey, matched, reason: 'docs_disabled' };
    }

    const disabled = await getDocsDisableStatus(options.payload, options.paths);
    if (disabled.disabled) {
      await writeDocsBudgetState(budgetState, options.paths);
      return { shouldInject: false, budgetKey, matched, reason: 'scope_disabled' };
    }

    if (matched.length === 0) {
      await writeDocsBudgetState(budgetState, options.paths);
      return { shouldInject: false, budgetKey, matched, reason: 'no_trigger' };
    }

    pruneBudgetRecord(record, config.budget.turnWindow);
    if (record.injections.length >= config.budget.injectionRate) {
      await writeDocsBudgetState(budgetState, options.paths);
      return { shouldInject: false, budgetKey, matched, reason: 'budget_exhausted' };
    }

    await writeDocsBudgetState(budgetState, options.paths);
    return { shouldInject: true, budgetKey, matched };
  } catch {
    return { shouldInject: false, budgetKey, matched, reason: 'state_error' };
  }
}

export async function recordDocsInjection(options: RecordDocsInjectionOptions): Promise<void> {
  try {
    const state = await readDocsBudgetState(options.paths);
    const now = options.now ?? new Date();
    const record = state.records[options.budgetKey] ?? { turn: 0, injections: [] };
    state.records[options.budgetKey] = record;
    record.injections.push({ turn: record.turn, ts: now.toISOString(), tokens: options.tokens });
    await writeDocsBudgetState(state, options.paths);
  } catch {
    return;
  }
}

export async function setDocsDisabled(options: SetDocsDisabledOptions): Promise<void> {
  const state = await readDocsDisableState(options.paths);
  const entry: DocsDisableEntry = {
    disabled: options.disabled,
    updatedAt: (options.now ?? new Date()).toISOString(),
    reason: options.reason,
  };

  switch (options.scope) {
    case 'global':
      state.global = entry;
      break;
    case 'project':
      state.projects[docsProjectKey(options.projectPath)] = entry;
      break;
    case 'session':
      state.sessions[docsSessionKey(options.sessionId)] = entry;
      break;
  }

  await writeDocsDisableState(state, options.paths);
}

export async function getDocsDisableStatus(
  payload: Pick<DocsHookPayload, 'sessionId' | 'projectPath'>,
  paths?: DocsPathOverrides,
): Promise<{ disabled: boolean; scope?: DocsDisableScope; entry?: DocsDisableEntry }> {
  const state = await readDocsDisableState(paths);
  const sessionEntry = state.sessions[docsSessionKey(payload.sessionId)];
  if (sessionEntry) return { disabled: sessionEntry.disabled, scope: 'session', entry: sessionEntry };

  const projectEntry = state.projects[docsProjectKey(payload.projectPath)];
  if (projectEntry) return { disabled: projectEntry.disabled, scope: 'project', entry: projectEntry };

  if (state.global) return { disabled: state.global.disabled, scope: 'global', entry: state.global };
  return { disabled: false };
}

export async function recordDocsTelemetry(options: RecordDocsTelemetryOptions): Promise<void> {
  try {
    const entry: DocsTelemetryEntry = {
      ts: (options.now ?? new Date()).toISOString(),
      event: options.injectedTokens > 0 ? 'injection' : 'query',
      queryCount: options.queryCount,
      injectedTokens: options.injectedTokens,
      hit: options.hit,
      reason: options.reason,
      matched: options.matched,
      budgetKey: options.budgetKey,
      chunkCount: options.chunkCount,
    };
    const telemetryPath = getDocsTelemetryPath(options.paths);
    await mkdir(dirname(telemetryPath), { recursive: true });
    await appendFile(telemetryPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    return;
  }
}

export function matchDocsTrigger(prompt: string, trigger: NormalizedDocsConfig['trigger']): string[] {
  const flags = trigger.caseSensitive ? 'u' : 'iu';
  return trigger.regexes.filter((pattern) => {
    try {
      return new RegExp(pattern, flags).test(prompt);
    } catch {
      return false;
    }
  });
}

export function docsBudgetKey(payload: Pick<DocsHookPayload, 'sessionId' | 'projectPath'>): string {
  if (payload.sessionId?.trim()) return `session:${payload.sessionId.trim()}`;
  if (payload.projectPath?.trim()) return `project:${docsProjectKey(payload.projectPath)}`;
  return 'anonymous';
}

export async function readDocsDisableState(paths?: DocsPathOverrides): Promise<DocsDisableState> {
  return readJsonFile(getDocsDisableStatePath(paths), { projects: {}, sessions: {} });
}

export async function readDocsBudgetState(paths?: DocsPathOverrides): Promise<DocsBudgetState> {
  return readJsonFile(getDocsBudgetStatePath(paths), { records: {} });
}

async function writeDocsDisableState(state: DocsDisableState, paths?: DocsPathOverrides): Promise<void> {
  await writeJsonFile(getDocsDisableStatePath(paths), state);
}

async function writeDocsBudgetState(state: DocsBudgetState, paths?: DocsPathOverrides): Promise<void> {
  await writeJsonFile(getDocsBudgetStatePath(paths), state);
}

function mergeGateConfig(
  config?: Pick<NormalizedDocsConfig, 'enabled' | 'promptInjectionEnabled' | 'trigger' | 'budget'>,
): Pick<NormalizedDocsConfig, 'enabled' | 'promptInjectionEnabled' | 'trigger' | 'budget'> {
  return {
    enabled: config?.enabled ?? DEFAULT_DOCS_CONFIG.enabled,
    promptInjectionEnabled: config?.promptInjectionEnabled ?? DEFAULT_DOCS_CONFIG.promptInjectionEnabled,
    trigger: config?.trigger ?? DEFAULT_DOCS_CONFIG.trigger,
    budget: config?.budget ?? DEFAULT_DOCS_CONFIG.budget,
  };
}

function advanceBudgetRecord(state: DocsBudgetState, budgetKey: string): DocsBudgetRecord {
  const record = state.records[budgetKey] ?? { turn: 0, injections: [] };
  state.records[budgetKey] = record;
  record.turn++;
  return record;
}

function pruneBudgetRecord(record: DocsBudgetRecord, turnWindow: number): void {
  record.injections = record.injections.filter((injection) => record.turn - injection.turn < turnWindow);
}

function docsSessionKey(sessionId?: string | null): string {
  return sessionId?.trim() || 'missing-session';
}

function docsProjectKey(projectPath?: string | null): string {
  if (!projectPath?.trim()) return 'missing-project';
  return createHash('sha256').update(resolve(projectPath)).digest('hex').slice(0, 16);
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
