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
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Lock } from 'lucide-react';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { cn } from '../../lib/utils';

export type SkillOverrideLevel = 'global' | 'project' | 'issue';
type Source = 'core' | 'global' | 'project' | 'issue' | 'default';

export interface SkillState {
  name: string;
  description: string;
  core: boolean;
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
  const [coreOpen, setCoreOpen] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, { message: string; enabled: boolean | null }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

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
  const core = skills.filter(skill => skill.core);
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
  const visible = skills.filter((skill) => {
    if (level !== 'global' && skill.core) return false;
    if (needle && !skill.name.toLowerCase().includes(needle) && !skill.description.toLowerCase().includes(needle)) return false;
    switch (filter) {
      case 'off': return !skill.enabled;
      case 'core': return skill.core;
      case 'below': return !skill.core && belowNote(below[skill.name]) !== null;
      case 'here': return levelValue(skill, level) !== null;
      case 'relevant': return levelValue(skill, level) !== null || !skill.enabled;
      default: return true;
    }
  });

  return (
    <div className="space-y-3" data-testid={`skill-overrides-${level}`}>
      <p className="text-sm text-muted-foreground">
        Changes apply to Claude Code and Codex agents at their next launch. Only Claude Code and Codex launches apply
        skill choices; remote (Fly) launches get every skill, and running agents keep the skills they launched with.
      </p>

      {query.isLoading && <p className="text-sm text-muted-foreground">Loading skills…</p>}
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
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Filter skills by name or description"
              aria-label="Filter skills"
              className="h-8 min-w-[220px] flex-1 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground"
            />
            {FILTERS[level].map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={cn('chip h-8 text-xs', filter === key && 'chip-selected')}
              >
                {label}
                <span className="font-mono text-muted-foreground">{counts[key]}</span>
              </button>
            ))}
          </div>

          <div className="divide-y divide-border rounded-md border border-border">
            {level !== 'global' && core.length > 0 && (
              <div className="px-3 py-2">
                <button
                  type="button"
                  aria-expanded={coreOpen}
                  onClick={() => setCoreOpen(open => !open)}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', coreOpen && 'rotate-90')} />
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  {core.length} core skills, always on
                </button>
                {coreOpen && (
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-6 font-mono text-xs text-muted-foreground" aria-label="Core skills">
                    {core.map(skill => <li key={skill.name}>{skill.name}</li>)}
                  </ul>
                )}
              </div>
            )}

            {visible.length === 0 && (
              <div className="px-3 py-4 text-sm text-muted-foreground">No skills match this filter.</div>
            )}

            {visible.map(skill => (
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
        </>
      )}
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto_7rem] items-start gap-3 px-3 py-2" data-skill={skill.name}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className={cn('font-mono text-sm', skill.enabled ? 'text-foreground' : 'text-muted-foreground')}>{skill.name}</span>
          {skill.projectSkill && <span className="eyebrow">project skill</span>}
        </div>
        {skill.description && <p className="truncate text-xs text-muted-foreground" title={skill.description}>{skill.description}</p>}
        {below && <p className="text-xs text-muted-foreground">{below}</p>}
        {error && (
          <p className="mt-1 flex items-center gap-2 text-xs text-destructive" role="alert">
            Save failed: {error.message}
            <button type="button" className="underline" onClick={() => onSave(error.enabled)}>Retry</button>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {level === 'global' ? (
          <>
            <button
              type="button"
              role="switch"
              aria-checked={skill.core || skill.global !== false}
              aria-label={`${skill.name} global default`}
              disabled={skill.core || saving}
              onClick={() => onSave(skill.global === false ? null : false)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors disabled:cursor-not-allowed',
                skill.core || skill.global !== false ? 'bg-foreground' : 'bg-muted',
                skill.core && 'opacity-50',
              )}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 rounded-full bg-background transition-transform',
                  skill.core || skill.global !== false ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
            {skill.core && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />Core — always on
              </span>
            )}
          </>
        ) : (
          <div role="group" aria-label={`${skill.name} at ${level} level`} className="inline-flex overflow-hidden rounded-md border border-border text-xs">
            {([[null, `Inherit (${inherit.on ? 'on' : 'off'} via ${inherit.from})`], [true, 'On'], [false, 'Off']] as const).map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={current === value}
                disabled={saving}
                onClick={() => onSave(value)}
                className={cn(
                  'px-2 py-1 text-muted-foreground transition-colors hover:bg-muted',
                  current === value && 'bg-muted text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="text-right">
        <div className="font-mono text-sm text-foreground">{skill.enabled ? 'on' : 'off'}</div>
        <div className="font-mono text-xs text-muted-foreground">{skill.source}</div>
      </div>
    </div>
  );
}
