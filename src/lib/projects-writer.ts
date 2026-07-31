import { readFile, writeFile } from 'node:fs/promises';
import { isMap, parseDocument, stringify, type Pair, type YAMLMap } from 'yaml';
import {
  PROJECTS_CONFIG_FILE,
  invalidateProjectsConfigCache,
  validateVersionSyncConfig,
  type VersionSyncConfig,
} from './projects.js';

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

function renderVersionSync(block: VersionSyncConfig): string {
  const rendered = stringify({ version_sync: block }, { indent: 2, lineWidth: 120 }).trimEnd();
  return `${rendered.split('\n').map(line => `    ${line}`).join('\n')}\n`;
}

export async function setProjectVersionSync(
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
  if (!projectPair || !isMap(projectPair.value)) {
    throw new Error(
      `Unknown project key: ${projectKey}. Known project keys: ${knownKeys.length > 0 ? knownKeys.join(', ') : '(none)'}`,
    );
  }

  let replacement = '';
  if (block !== null) {
    const validation = validateVersionSyncConfig(block);
    if (!validation.ok) throw new Error(validation.errors.join('; '));
    replacement = renderVersionSync(validation.config);
  }

  const project = projectPair.value as YAMLMap;
  const versionPair = project.items.find(pair => keyValue(pair) === 'version_sync');
  let updated: string;
  if (versionPair) {
    const keyRange = nodeRange(versionPair.key);
    const valueRange = nodeRange(versionPair.value);
    if (!keyRange || !valueRange) throw new Error(`Could not locate ${projectKey}.version_sync in projects.yaml`);
    updated = content.slice(0, lineStart(content, keyRange[0])) + replacement + content.slice(valueRange[2]);
  } else if (block === null) {
    return;
  } else {
    if (!project.range) throw new Error(`Could not locate project ${projectKey} in projects.yaml`);
    updated = content.slice(0, project.range[1]) + replacement + content.slice(project.range[1]);
  }

  await writeFile(PROJECTS_CONFIG_FILE, updated, 'utf-8');
  invalidateProjectsConfigCache();
}
