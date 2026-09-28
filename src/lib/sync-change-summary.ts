/**
 * PAN-4265: turn two sync-input digest maps into one sentence that says what
 * changed, for example "3 skills and 1 rule changed".
 *
 * Input keys follow the v2 sync manifest grammar in `sync-startup-gate.ts`:
 * `sync-sources/<relpath>`, `global-context`, `project-context/<key>`,
 * `project-skills/<key>/<relpath>`, `cwd`, `cwd-skills/<relpath>`, `dev-mode`.
 * Pure: no I/O.
 */

export interface SyncChangeSummary {
  summary: string;
  changedKeys: string[];
}

const COUNTED_NOUNS = [
  'skill',
  'rule',
  'hook',
  'agent definition',
  'template',
  'project skill',
  'project context',
  'other sync-sources file',
] as const;

const SINGLETONS = [
  'the plugin list',
  'the global context',
  'dev mode',
  'the working-directory skills',
] as const;

type CountedNoun = (typeof COUNTED_NOUNS)[number];
type Singleton = (typeof SINGLETONS)[number];
type Unit = { noun: CountedNoun; id: string } | { singleton: Singleton };

const SYNC_SOURCES_DIRS: Record<string, CountedNoun> = {
  rules: 'rule',
  hooks: 'hook',
  agents: 'agent definition',
  templates: 'template',
};

function isCwdKey(key: string): boolean {
  return key === 'cwd' || key.startsWith('cwd-skills/');
}

function unitForKey(key: string): Unit {
  if (key === 'global-context') return { singleton: 'the global context' };
  if (key === 'dev-mode') return { singleton: 'dev mode' };
  if (isCwdKey(key)) return { singleton: 'the working-directory skills' };
  if (key.startsWith('project-context/')) {
    return { noun: 'project context', id: key.slice('project-context/'.length) };
  }
  if (key.startsWith('project-skills/')) {
    const [projectKey, name] = key.slice('project-skills/'.length).split('/');
    return { noun: 'project skill', id: `${projectKey}/${name}` };
  }

  const rest = key.startsWith('sync-sources/') ? key.slice('sync-sources/'.length) : key;
  if (rest === 'plugins.json') return { singleton: 'the plugin list' };
  const slash = rest.indexOf('/');
  const top = slash === -1 ? rest : rest.slice(0, slash);
  const below = slash === -1 ? '' : rest.slice(slash + 1);
  if (below && (top === 'skills' || top === 'dev-skills')) {
    const name = below.split('/')[0];
    return { noun: 'skill', id: top === 'dev-skills' ? `dev:${name}` : name };
  }
  const noun = below ? SYNC_SOURCES_DIRS[top] : undefined;
  if (noun) return { noun, id: below };
  return { noun: 'other sync-sources file', id: rest };
}

function joinParts(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function summarizeSyncInputChanges(
  previous: Record<string, string> | null | 'no-record',
  current: Record<string, string>,
  opts: { excludeCwd?: boolean } = {},
): SyncChangeSummary {
  if (previous === null) {
    return { summary: 'No sync has been recorded on this machine', changedKeys: [] };
  }
  if (previous === 'no-record') {
    return {
      summary: 'Setup inputs changed since the last sync (the previous sync kept no per-file record)',
      changedKeys: [],
    };
  }

  const excludeCwd = opts.excludeCwd ?? true;
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  const changedKeys = [...allKeys]
    .filter((key) => previous[key] !== current[key])
    .filter((key) => !(excludeCwd && isCwdKey(key)))
    .sort();

  if (changedKeys.length === 0) return { summary: 'Setup inputs changed', changedKeys };

  const idsByNoun = new Map<CountedNoun, Set<string>>();
  const singletons = new Set<Singleton>();
  for (const key of changedKeys) {
    const unit = unitForKey(key);
    if ('singleton' in unit) {
      singletons.add(unit.singleton);
    } else {
      const ids = idsByNoun.get(unit.noun) ?? new Set<string>();
      ids.add(unit.id);
      idsByNoun.set(unit.noun, ids);
    }
  }

  const parts: string[] = [];
  for (const noun of COUNTED_NOUNS) {
    const count = idsByNoun.get(noun)?.size ?? 0;
    if (count > 0) parts.push(count === 1 ? `1 ${noun}` : `${count} ${noun}s`);
  }
  for (const singleton of SINGLETONS) {
    if (singletons.has(singleton)) parts.push(singleton);
  }

  return { summary: `${joinParts(parts)} changed`, changedKeys };
}
