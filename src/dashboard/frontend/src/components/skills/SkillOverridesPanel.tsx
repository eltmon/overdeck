/**
 * Per-skill on/off overrides (PAN-3942) — one panel, three levels.
 *
 * - global (Skills page): a two-state switch per skill. Off stores an
 *   override; on clears it, because on is the default.
 * - project / issue: Inherit | On | Off. Inherit shows the value it inherits.
 *
 * The operator-approved UI decisions on the issue shape the details: core
 * skills collapse to one summary row below global, project-only skills are
 * tagged, the issue view opens filtered to what matters, the global page
 * names the projects and issues that override a skill, and a failed save
 * shows an inline error with Retry on its own row.
 *
 * Skill packs (PAN-4334) render above the skill list in SkillPacksSection
 * when the response carries `packs`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Search, X } from 'lucide-react';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { cn } from '../../lib/utils';
import { GroupHeader, LevelChoice, RowError, SkillSwitch } from './SkillControls';
import { SkillPacksSection, type PackState } from './SkillPacksSection';

export type SkillOverrideLevel = 'global' | 'project' | 'issue';
type Source = 'core' | 'global' | 'project' | 'issue' | 'default';
type SkillOrigin = 'overdeck' | 'personal' | 'project';
type GroupKey = 'core' | SkillOrigin;

/** Skills group by where they come from; core skills form their own group. */
const GROUPS: Array<{ key: GroupKey; title: string; hint: string }> = [
  { key: 'core', title: 'Core', hint: 'Always on; the pipeline depends on them' },
  { key: 'overdeck', title: 'Overdeck', hint: '~/.overdeck/skills' },
  { key: 'personal', title: 'Personal', hint: '~/.claude/skills, ~/.agents/skills' },
  { key: 'project', title: 'Project', hint: '.pan/skills in this project' },
];

function groupOf(skill: SkillState): GroupKey {
  if (skill.core) return 'core';
  return skill.origin ?? (skill.projectSkill ? 'project' : 'personal');
}

export interface SkillState {
  name: string;
  description: string;
  core: boolean;
  /** Where the skill lives: ~/.overdeck/skills, ~/.claude or ~/.agents skills, or the project's .pan/skills. */
  origin?: SkillOrigin;
  projectSkill: boolean;
  global: boolean | null;
  project: boolean | null;
  issue: boolean | null;
  enabled: boolean;
  source: Source;
}

interface SkillStatesResponse {
  project: string | null;
  issue: string | null;
  skills: SkillState[];
  overriddenBelow?: Record<string, { projects: string[]; issues: string[] }>;
  packs?: PackState[];
  packOverriddenBelow?: Record<string, { projects: string[]; issues: string[] }>;
}

interface SaveResult {
  committed?: boolean;
  pushed?: boolean;
  reason?: string;
}

export const SKILL_OVERRIDES_QUERY_KEY = ['skill-overrides'] as const;
const ENDPOINT = '/api/skills/overrides';

type Filter = 'all' | 'off' | 'core' | 'below' | 'here' | 'relevant';

const FILTERS: Record<SkillOverrideLevel, Array<[Filter, string]>> = {
  global: [['all', 'All'], ['off', 'Off'], ['core', 'Core'], ['below', 'Overridden below']],
  project: [['all', 'All'], ['here', 'Overridden here'], ['off', 'Off at launch']],
  issue: [['relevant', 'Overridden here or off'], ['all', 'All']],
};

export interface SkillOverridesPanelProps {
  level: SkillOverrideLevel;
  projectKey?: string;
  issueId?: string;
  /** False while a surrounding disclosure is collapsed: nothing is fetched. */
  enabled?: boolean;
  /** Called when the issue has no resolvable project, so the host can hide its section. */
  onUnavailable?: () => void;
  /** Live agents for this issue; after a save, the panel notes the change applies at their next launch. */
  liveAgents?: string[];
}

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) {
    super(message);
  }
}

async function fetchSkillStates(projectKey?: string, issueId?: string): Promise<SkillStatesResponse> {
  const params = new URLSearchParams();
  if (projectKey) params.set('project', projectKey);
  if (issueId) params.set('issue', issueId);
  const query = params.toString();
  const res = await fetch(query ? `${ENDPOINT}?${query}` : ENDPOINT);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new RequestError(res.status, body?.code, body?.error ?? `HTTP ${res.status}`);
  return body as SkillStatesResponse;
}

function levelValue(skill: SkillState, level: SkillOverrideLevel): boolean | null {
  return skill[level];
}

/** The value a skill would have at this level with no override here, and where it comes from. */
function inherited(skill: SkillState, level: SkillOverrideLevel): { on: boolean; from: string } {
  if (level === 'issue' && skill.project !== null) return { on: skill.project, from: 'project' };
  return { on: skill.global !== false, from: 'global' };
}

function belowNote(entry: { projects: string[]; issues: string[] } | undefined): string | null {
  if (!entry) return null;
  const parts: string[] = [];
  if (entry.projects.length) parts.push(`${entry.projects.length} project${entry.projects.length === 1 ? '' : 's'}`);
  if (entry.issues.length) parts.push(`${entry.issues.length} issue${entry.issues.length === 1 ? '' : 's'}`);
  return parts.length ? `overridden in ${parts.join(', ')}` : null;
}

export function SkillOverridesPanel({ level, projectKey, issueId, enabled = true, onUnavailable, liveAgents = [] }: SkillOverridesPanelProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(FILTERS[level][0][0]);
  const [openGroups, setOpenGroups] = useState<Partial<Record<GroupKey, boolean>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, { message: string; enabled: boolean | null }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const packsRef = useRef<HTMLElement>(null);

  const query = useQuery({
    queryKey: [...SKILL_OVERRIDES_QUERY_KEY, level, projectKey ?? null, issueId ?? null],
    queryFn: () => fetchSkillStates(projectKey, issueId),
    enabled,
    retry: false,
  });

  const save = async (skill: string, value: boolean | null) => {
    setSaving(prev => ({ ...prev, [skill]: true }));
    setRowErrors(({ [skill]: _cleared, ...rest }) => rest);
    try {
      const body = { level, skill, enabled: value, ...(projectKey ? { projectKey } : {}), ...(issueId ? { issueId } : {}) };
      const res = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: await dashboardMutationJsonHeaders(ENDPOINT),
        body: JSON.stringify(body),
      });
      const result = (await res.json().catch(() => ({}))) as SaveResult & { error?: string };
      if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
      setNotice(result.committed && result.pushed === false ? `Saved locally; push pending: ${result.reason ?? 'unknown reason'}` : null);
      setChanged(true);
      await queryClient.invalidateQueries({ queryKey: SKILL_OVERRIDES_QUERY_KEY });
    } catch (error) {
      setRowErrors(prev => ({ ...prev, [skill]: { message: error instanceof Error ? error.message : String(error), enabled: value } }));
    } finally {
      setSaving(({ [skill]: _done, ...rest }) => rest);
    }
  };

  const data = query.data;
  const below = data?.overriddenBelow ?? {};
  const skills = useMemo(() => data?.skills ?? [], [data]);
  const counts = useMemo(() => ({
    all: skills.length,
    off: skills.filter(skill => !skill.enabled).length,
    core: skills.filter(skill => skill.core).length,
    below: skills.filter(skill => !skill.core && belowNote(below[skill.name])).length,
    here: skills.filter(skill => !skill.core && levelValue(skill, level) !== null).length,
    relevant: skills.filter(skill => !skill.core && (levelValue(skill, level) !== null || !skill.enabled)).length,
  }), [skills, below, level]);

  // Decision #6: an issue no registered project owns has no skills section.
  const unavailable = query.error instanceof RequestError && query.error.code === 'unknown-issue';
  useEffect(() => {
    if (unavailable) onUnavailable?.();
  }, [unavailable, onUnavailable]);
  if (unavailable) return null;

  const needle = search.trim().toLowerCase();
  // While a search or a narrowing filter is active, every group holding a match opens.
  const narrowing = needle !== '' || filter !== 'all';
  const visible = skills.filter((skill) => {
    if (needle && !skill.name.toLowerCase().includes(needle) && !skill.description.toLowerCase().includes(needle)) return false;
    switch (filter) {
      case 'off': return !skill.enabled;
      case 'core': return skill.core;
      case 'below': return !skill.core && belowNote(below[skill.name]) !== null;
      case 'here': return !skill.core && levelValue(skill, level) !== null;
      case 'relevant': return !skill.core && (levelValue(skill, level) !== null || !skill.enabled);
      default: return true;
    }
  });
  const groups = GROUPS
    .map(group => ({ ...group, all: skills.filter(skill => groupOf(skill) === group.key), rows: visible.filter(skill => groupOf(skill) === group.key) }))
    // Below global, core skills are not choices: they stay one summary group whatever the filter.
    .filter(group => (narrowing && !(group.key === 'core' && level !== 'global') ? group.rows.length > 0 : group.all.length > 0));
  const isOpen = (key: GroupKey) => openGroups[key] ?? (narrowing || (key !== 'core' && key !== 'overdeck'));
  const resetGroups = () => setOpenGroups({});
  const packs = data?.packs;
  const packsOn = packs?.filter(pack => pack.enabled).length ?? 0;

  return (
    <div className="space-y-4" data-testid={`skill-overrides-${level}`}>
      <div className="space-y-1.5">
        {data && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground" data-testid="skills-summary">
            <span className="dot-metadata"><span className="text-foreground">{counts.all - counts.off}</span> on</span>
            <span aria-hidden>·</span>
            <span className="dot-metadata"><span className={cn(counts.off > 0 && 'text-foreground')}>{counts.off}</span> off</span>
            <span aria-hidden>·</span>
            <span className="dot-metadata">{counts.core} core</span>
            {packs && packs.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => {
                    packsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    packsRef.current?.focus({ preventScroll: true });
                  }}
                  className="dot-metadata rounded underline decoration-border underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {packs.length} pack{packs.length === 1 ? '' : 's'}, {packsOn} on
                </button>
              </>
            )}
          </p>
        )}
        <p className="max-w-[72ch] text-[13px] leading-relaxed text-body-foreground">
          Changes apply to Claude Code and Codex agents at their next launch. Only Claude Code and Codex launches apply
          skill choices; remote (Fly) launches get every skill, and running agents keep the skills they launched with.
        </p>
      </div>

      {query.isLoading && <SkillListSkeleton />}
      {query.error && !(query.error instanceof RequestError && query.error.code === 'unknown-issue') && (
        <p className="text-sm text-destructive">Could not load skills: {query.error.message}</p>
      )}
      {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
      {changed && liveAgents.length > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="skills-changed-since-launch">
          Skills changed since launch; applies next launch ({liveAgents.join(', ')} running).
        </p>
      )}

      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[220px] flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={search}
                onChange={(event) => { setSearch(event.target.value); resetGroups(); }}
                placeholder="Filter skills by name or description"
                aria-label="Filter skills"
                className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => { setSearch(''); resetGroups(); }}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {FILTERS[level].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => { setFilter(key); resetGroups(); }}
                  className={cn('chip h-8 px-2.5 text-xs', filter === key && 'chip-selected')}
                >
                  {label}
                  <span className="font-mono-ui tabular-nums text-muted-foreground">{counts[key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {groups.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No skills match {needle ? <>“{search.trim()}”</> : 'this filter'}.
              </div>
            )}
            {groups.map((group, index) => {
              const open = isOpen(group.key);
              const on = group.all.filter(skill => skill.enabled).length;
              return (
                <section key={group.key} data-skill-group={group.key} className={cn(index > 0 && 'border-t border-border')}>
                  <GroupHeader
                    title={group.key === 'core' && level !== 'global' ? `${group.all.length} core skills, always on` : group.title}
                    open={open}
                    onToggle={() => setOpenGroups(prev => ({ ...prev, [group.key]: !open }))}
                    hint={group.key === 'core' && level !== 'global' ? undefined : group.hint}
                    count={narrowing && group.key !== 'core' && group.rows.length !== group.all.length
                      ? `${group.rows.length} match${group.rows.length === 1 ? '' : 'es'}`
                      : group.key === 'core' ? <Lock aria-label="Locked" className="h-3.5 w-3.5" /> : `${on} of ${group.all.length} on`}
                  />
                  {open && group.key === 'core' && level !== 'global' && (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-3 py-2 pl-9 font-mono text-xs text-muted-foreground" aria-label="Core skills">
                      {group.all.map(skill => <li key={skill.name}>{skill.name}</li>)}
                    </ul>
                  )}
                  {open && !(group.key === 'core' && level !== 'global') && (
                    <div className="divide-y divide-border border-t border-border">
                      {group.rows.map(skill => (
                        <SkillRow
                          key={skill.name}
                          skill={skill}
                          level={level}
                          below={level === 'global' ? belowNote(below[skill.name]) : null}
                          saving={saving[skill.name] === true}
                          error={rowErrors[skill.name]}
                          onSave={value => void save(skill.name, value)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {Array.isArray(packs) && (
            <SkillPacksSection
              level={level}
              projectKey={projectKey}
              issueId={issueId}
              packs={packs}
              packOverriddenBelow={data.packOverriddenBelow}
              search={needle}
              sectionRef={packsRef}
            />
          )}
        </>
      )}
    </div>
  );
}

function SkillListSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card" aria-busy="true" aria-label="Loading skills">
      {[0, 1, 2, 3, 4, 5].map(index => (
        <div key={index} className={cn('flex items-center gap-4 px-3 py-2.5', index > 0 && 'border-t border-border')}>
          <span className="h-3 w-32 animate-pulse rounded bg-muted" />
          <span className="h-3 flex-1 animate-pulse rounded bg-muted" />
          <span className="h-[18px] w-8 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

interface SkillRowProps {
  skill: SkillState;
  level: SkillOverrideLevel;
  below: string | null;
  saving: boolean;
  error?: { message: string; enabled: boolean | null };
  onSave: (value: boolean | null) => void;
}

function SkillRow({ skill, level, below, saving, error, onSave }: SkillRowProps) {
  const current = levelValue(skill, level);
  const inherit = inherited(skill, level);
  return (
    <div
      className={cn(
        'list-row grid items-start gap-x-4 gap-y-1 px-3 py-2',
        level === 'global'
          ? 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)_auto]'
          : 'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)_auto_4.5rem]',
      )}
      data-skill={skill.name}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 pt-px">
        <span className={cn('truncate font-mono-ui text-[13px]', skill.enabled ? 'text-foreground' : 'text-muted-foreground')}>{skill.name}</span>
        {skill.projectSkill && <span className="text-[11px] text-muted-foreground">project skill</span>}
      </div>

      <div className="col-start-1 row-start-2 min-w-0 md:col-start-2 md:row-start-1">
        {skill.description && <p className="line-clamp-2 text-xs leading-5 text-muted-foreground md:line-clamp-1" title={skill.description}>{skill.description}</p>}
        {below && <p className="text-xs leading-5 text-body-foreground">{below}</p>}
        {error && <RowError message={error.message} onRetry={() => onSave(error.enabled)} />}
      </div>

      <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-2 self-center md:col-start-3 md:row-span-1">
        {level === 'global' ? (
          <SkillSwitch
            checked={skill.core || skill.global !== false}
            label={skill.core ? `${skill.name} is a core skill, always on` : `${skill.name} global default`}
            locked={skill.core}
            disabled={saving}
            onToggle={() => onSave(skill.global === false ? null : false)}
          />
        ) : (
          <LevelChoice
            label={`${skill.name} at ${level} level`}
            current={current}
            inheritLabel={`Inherit (${inherit.on ? 'on' : 'off'} via ${inherit.from})`}
            saving={saving}
            onSet={onSave}
          />
        )}
      </div>

      {level !== 'global' && (
        <div className="hidden text-right font-mono-ui text-xs leading-5 md:block">
          <span className={skill.enabled ? 'text-foreground' : 'text-muted-foreground'}>{skill.enabled ? 'on' : 'off'}</span>
          <span className="block text-muted-foreground">{skill.source}</span>
        </div>
      )}
    </div>
  );
}
