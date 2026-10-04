/**
 * Per-conversation skill choices for the new-conversation options dialog
 * (PAN-4486). Each non-core skill and each pack skill shows the state it would
 * inherit (from GET /api/skills/overrides) and an Inherit / On / Off choice.
 * Only explicit choices reach `value`; Inherit removes the key. The dialog
 * sends `value` as `skillOverrides`, which the server stores on the row and
 * applies as the narrowest skill layer at every launch.
 *
 * Rows are grouped into collapsible sections (PAN-4528): native skills by
 * their catalog origin ('project' → 'Project skills', 'overdeck' →
 * 'Overdeck', 'personal' → 'Personal'), then one group per skill pack. A
 * group opens when it holds a row with an explicit choice, when the filter
 * matches one of its rows, or when its header is clicked.
 *
 * D8: an issue no registered project owns answers non-OK, so the field
 * refetches without the issue; if that fails too it shows "Skills unavailable".
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import styles from './ConversationSkillsField.module.css';

interface SkillRow {
  id: string;
  enabled: boolean;
  source: string;
  description: string;
}

interface SkillGroup {
  key: string;
  label: string;
  rows: SkillRow[];
}

interface SkillOverridesResponse {
  skills?: Array<{
    name: string;
    core: boolean;
    enabled: boolean;
    source: string;
    description?: string;
    origin?: 'overdeck' | 'personal' | 'project';
  }>;
  packs?: Array<{ id: string; skills?: Array<{ id: string; enabled: boolean; source: string; description?: string }> }>;
}

const ORIGIN_GROUPS: ReadonlyArray<['overdeck' | 'personal' | 'project', string]> = [
  ['project', 'Project skills'],
  ['overdeck', 'Overdeck'],
  ['personal', 'Personal'],
];

export interface ConversationSkillsFieldProps {
  projectKey?: string;
  issueId?: string;
  value: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
}

const ENDPOINT = '/api/skills/overrides';

async function fetchOverrides(projectKey?: string, issueId?: string): Promise<Response> {
  const params = new URLSearchParams();
  if (projectKey) params.set('project', projectKey);
  if (issueId) params.set('issue', issueId);
  const query = params.toString();
  return fetch(query ? `${ENDPOINT}?${query}` : ENDPOINT);
}

function toRow(skill: { id: string; enabled: boolean; source: string; description?: string }): SkillRow {
  return { id: skill.id, enabled: skill.enabled, source: skill.source, description: skill.description ?? '' };
}

async function fetchSkillGroups(projectKey?: string, issueId?: string): Promise<SkillGroup[]> {
  let res = await fetchOverrides(projectKey, issueId);
  if (!res.ok && issueId) res = await fetchOverrides(projectKey);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as SkillOverridesResponse;

  const byOrigin = new Map<string, SkillRow[]>();
  for (const skill of body.skills ?? []) {
    if (skill.core) continue;
    const origin = skill.origin ?? 'personal';
    const rows = byOrigin.get(origin) ?? [];
    rows.push(toRow({ id: skill.name, enabled: skill.enabled, source: skill.source, description: skill.description }));
    byOrigin.set(origin, rows);
  }

  const groups: SkillGroup[] = [];
  for (const [origin, label] of ORIGIN_GROUPS) {
    const rows = byOrigin.get(origin);
    if (rows?.length) groups.push({ key: origin, label, rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)) });
  }
  for (const pack of body.packs ?? []) {
    const rows = (pack.skills ?? []).map(toRow);
    if (rows.length) groups.push({ key: `pack:${pack.id}`, label: pack.id, rows: rows.sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return groups;
}

const CHOICES: ReadonlyArray<[boolean | null, string]> = [[null, 'Inherit'], [true, 'On'], [false, 'Off']];

export function ConversationSkillsField({ projectKey, issueId, value, onChange }: ConversationSkillsFieldProps) {
  const [filter, setFilter] = useState('');
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const query = useQuery({
    queryKey: ['new-conversation-skills', projectKey ?? '', issueId ?? ''],
    queryFn: () => fetchSkillGroups(projectKey, issueId),
  });
  const groups = query.data;
  const rows = useMemo(() => (groups ?? []).flatMap(group => group.rows), [groups]);

  // Drop choices for skills the new context no longer lists.
  useEffect(() => {
    if (!groups) return;
    const listed = new Set(rows.map(row => row.id));
    const kept = Object.entries(value).filter(([id]) => listed.has(id));
    if (kept.length !== Object.keys(value).length) onChange(Object.fromEntries(kept));
  }, [groups, rows, value, onChange]);

  const needle = filter.trim().toLowerCase();
  const filtering = needle.length > 0;

  const visible = useMemo(() => {
    return (groups ?? [])
      .map(group => ({
        group,
        rows: filtering
          ? group.rows.filter(row => row.id.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle))
          : group.rows,
      }))
      .filter(entry => entry.rows.length > 0);
  }, [groups, filtering, needle]);

  const isOpen = (group: SkillGroup): boolean =>
    filtering || (opened[group.key] ?? group.rows.some(row => Object.prototype.hasOwnProperty.call(value, row.id)));

  const toggleGroup = (group: SkillGroup) => setOpened(prev => ({ ...prev, [group.key]: !isOpen(group) }));

  const choose = (group: SkillGroup, id: string, choice: boolean | null) => {
    const next = { ...value };
    if (choice === null) delete next[id];
    else next[id] = choice;
    onChange(next);
    setOpened(prev => ({ ...prev, [group.key]: true }));
  };

  if (query.isLoading) return <p className={styles.note}>Loading skills…</p>;
  if (query.isError || !groups) return <p className={styles.note}>Skills unavailable</p>;

  return (
    <div className={styles.field}>
      <input
        type="text"
        className={styles.filter}
        aria-label="Filter skills"
        placeholder="Filter skills by name or description"
        value={filter}
        onChange={event => setFilter(event.target.value)}
      />
      <div className={styles.list}>
        {visible.length === 0 && <p className={styles.note}>No skills match.</p>}
        {visible.map(({ group, rows: groupRows }) => {
          const open = isOpen(group);
          const onCount = group.rows.filter(row =>
            Object.prototype.hasOwnProperty.call(value, row.id) ? value[row.id] : row.enabled,
          ).length;
          return (
            <div key={group.key} className={styles.group}>
              <button
                type="button"
                className={styles.groupHeader}
                aria-expanded={open}
                disabled={filtering}
                onClick={() => toggleGroup(group)}
              >
                <ChevronRight className={cn(styles.chevron, open && styles.chevronOpen)} />
                <span className={styles.groupLabel}>{group.label}</span>{' '}
                <span className={styles.groupCount}>{onCount} on · {group.rows.length}</span>
              </button>
              {open && groupRows.map(row => {
                const current = Object.prototype.hasOwnProperty.call(value, row.id) ? value[row.id] : null;
                return (
                  <div key={row.id} className={styles.row} data-skill={row.id}>
                    <div className={styles.nameCell}>
                      <span className={styles.name}>{row.id}</span>
                      {row.description && <span className={styles.description} title={row.description}>{row.description}</span>}
                    </div>
                    <span className={styles.inherited}>{row.enabled ? 'On' : 'Off'} · {row.source.replace('-', ' ')}</span>
                    <div role="radiogroup" aria-label={row.id} className={styles.choices}>
                      {CHOICES.map(([choice, label]) => (
                        <button
                          key={label}
                          type="button"
                          role="radio"
                          aria-checked={current === choice}
                          className={cn(styles.choice, current === choice && styles.choiceSelected)}
                          onClick={() => choose(group, row.id, choice)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
