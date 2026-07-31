import { readFile } from 'node:fs/promises';
import { isMap, parseDocument, stringify, type Pair, type YAMLMap } from 'yaml';
import {
  PROJECTS_CONFIG_FILE,
  invalidateProjectsConfigCache,
  validateVersionSyncConfig,
  type VersionSyncConfig,
} from './projects.js';
import { atomicWriteProjectsConfig, withProjectsConfigWrite } from './projects-config-write.js';

function keyValue(pair: Pair): string | undefined {
  const value = pair.key && typeof pair.key === 'object' && 'value' in pair.key
    ? pair.key.value
    : pair.key;
  return typeof value === 'string' ? value : undefined;
}

function lineStart(content: string, offset: number): number {
  return content.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

function nodeRange(value: unknown): [number, number, number] | undefined {
  if (typeof value !== 'object' || value === null || !('range' in value)) return undefined;
  const range = value.range;
  return Array.isArray(range) && range.length === 3 && range.every(offset => typeof offset === 'number')
    ? range as [number, number, number]
    : undefined;
}

function keyIndent(content: string, pair: Pair): string {
  const range = nodeRange(pair.key);
  if (!range) throw new Error('Could not locate a mapping key in projects.yaml');
  const indent = content.slice(lineStart(content, range[0]), range[0]);
  if (!/^\s*$/.test(indent)) throw new Error('Project mapping key does not start on its own line');
  return indent;
}

function inlineComment(
  content: string,
  value: unknown,
): { suffix: string; standalone: string } | null {
  if (typeof value !== 'object' || value === null || !('srcToken' in value)) return null;
  const range = nodeRange(value);
  if (!range) return null;

  const comments: Array<{ offset: number; source: string }> = [];
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (typeof candidate !== 'object' || candidate === null || seen.has(candidate)) return;
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    if (
      record.type === 'comment'
      && typeof record.offset === 'number'
      && typeof record.source === 'string'
      && record.offset >= range[0]
      && record.offset < range[1]
    ) {
      comments.push({ offset: record.offset, source: record.source });
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit((value as { srcToken: unknown }).srcToken);

  const comment = comments.sort((a, b) => b.offset - a.offset)[0];
  if (!comment) return null;
  const start = lineStart(content, comment.offset);
  const beforeComment = content.slice(start, comment.offset);
  if (beforeComment.trim().length === 0) return null;
  const spacing = /[ \t]*$/.exec(beforeComment)?.[0] ?? ' ';
  const indentation = /^[ \t]*/.exec(beforeComment)?.[0] ?? '';
  return {
    suffix: `${spacing}${comment.source}`,
    standalone: `${indentation}${comment.source}\n`,
  };
}

function renderVersionSync(block: VersionSyncConfig, indent: string): string {
  const rendered = stringify({ version_sync: block }, { indent: 2, lineWidth: 120 }).trimEnd();
  return `${rendered.split('\n').map(line => `${indent}${line}`).join('\n')}\n`;
}

async function setProjectVersionSyncUnlocked(
  projectKey: string,
  block: VersionSyncConfig | null,
): Promise<void> {
  const content = await readFile(PROJECTS_CONFIG_FILE, 'utf-8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'projects: {}\n';
    throw error;
  });
  const doc = parseDocument(content, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw new Error(`Could not parse projects.yaml: ${doc.errors.map(error => error.message).join('; ')}`);
  }

  const projectsNode = doc.getIn(['projects'], true);
  if (!isMap(projectsNode)) {
    throw new Error('projects.yaml must contain a projects mapping');
  }
  const projects = projectsNode as YAMLMap;
  const knownKeys = projects.items.map(keyValue).filter((key): key is string => key !== undefined);
  const projectPair = projects.items.find(pair => keyValue(pair) === projectKey);
  if (!projectPair) {
    throw new Error(
      `Unknown project key: ${projectKey}. Known project keys: ${knownKeys.length > 0 ? knownKeys.join(', ') : '(none)'}`,
    );
  }
  if (!isMap(projectPair.value)) {
    throw new Error(`Project ${projectKey} must use a block mapping before version_sync can be edited`);
  }

  const project = projectPair.value as YAMLMap;
  if (project.flow) {
    throw new Error(`Project ${projectKey} uses flow-style YAML; version_sync requires a block mapping`);
  }
  const versionPair = project.items.find(pair => keyValue(pair) === 'version_sync');
  const indentPair = versionPair ?? project.items[0];
  if (!indentPair) throw new Error(`Project ${projectKey} has no block fields to derive indentation from`);

  let replacement = '';
  if (block !== null) {
    const validation = validateVersionSyncConfig(block);
    if (!validation.ok) throw new Error(validation.errors.join('; '));
    replacement = renderVersionSync(validation.config, keyIndent(content, indentPair));
  }

  let updated: string;
  if (versionPair) {
    const keyRange = nodeRange(versionPair.key);
    const valueRange = nodeRange(versionPair.value);
    if (!keyRange || !valueRange) throw new Error(`Could not locate ${projectKey}.version_sync in projects.yaml`);
    const preservedInlineComment = inlineComment(content, versionPair.value);
    if (preservedInlineComment) {
      replacement = block === null
        ? preservedInlineComment.standalone
        : `${replacement.trimEnd()}${preservedInlineComment.suffix}\n`;
    }
    let start = lineStart(content, keyRange[0]);
    if (block === null && valueRange[1] === content.length && !content.endsWith('\n') && start > 0 && content[start - 1] === '\n') {
      start -= 1;
    }
    updated = content.slice(0, start) + replacement + content.slice(valueRange[1]);
  } else if (block === null) {
    return;
  } else {
    if (!project.range) throw new Error(`Could not locate project ${projectKey} in projects.yaml`);
    const offset = project.range[1];
    const atLineBoundary = offset === 0 || content[offset - 1] === '\n';
    const insertion = atLineBoundary ? replacement : `\n${replacement.trimEnd()}`;
    updated = content.slice(0, offset) + insertion + content.slice(offset);
  }

  await atomicWriteProjectsConfig(PROJECTS_CONFIG_FILE, updated);
  invalidateProjectsConfigCache();
}

export async function setProjectVersionSync(
  projectKey: string,
  block: VersionSyncConfig | null,
): Promise<void> {
  return withProjectsConfigWrite(PROJECTS_CONFIG_FILE, () => (
    setProjectVersionSyncUnlocked(projectKey, block)
  ));
}
