/**
 * Per-conversation skill choices for the new-conversation options dialog
 * (PAN-4486). Each non-core skill and each pack skill shows the state it would
 * inherit (from GET /api/skills/overrides) and an Inherit / On / Off choice.
 * Only explicit choices reach `value`; Inherit removes the key. The dialog
 * sends `value` as `skillOverrides`, which the server stores on the row and
 * applies as the narrowest skill layer at every launch.
 *
 * D8: an issue no registered project owns answers non-OK, so the field
 * refetches without the issue; if that fails too it shows "Skills unavailable".
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/utils';
import styles from './ConversationSkillsField.module.css';

interface SkillRow {
  id: string;
  enabled: boolean;
  source: string;
  description: string;
}

interface SkillOverridesResponse {
  skills?: Array<{ name: string; core: boolean; enabled: boolean; source: string; description?: string }>;
  packs?: Array<{ skills?: Array<{ id: string; enabled: boolean; source: string; description?: string }> }>;
}

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

async function fetchSkillRows(projectKey?: string, issueId?: string): Promise<SkillRow[]> {
  let res = await fetchOverrides(projectKey, issueId);
  if (!res.ok && issueId) res = await fetchOverrides(projectKey);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as SkillOverridesResponse;
  const rows: SkillRow[] = [
    ...(body.skills ?? []).filter(skill => !skill.core).map(skill => ({ id: skill.name, enabled: skill.enabled, source: skill.source, description: skill.description ?? '' })),
    ...(body.packs ?? []).flatMap(pack => pack.skills ?? []).map(skill => ({ id: skill.id, enabled: skill.enabled, source: skill.source, description: skill.description ?? '' })),
  ];
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

const CHOICES: ReadonlyArray<[boolean | null, string]> = [[null, 'Inherit'], [true, 'On'], [false, 'Off']];

export function ConversationSkillsField({ projectKey, issueId, value, onChange }: ConversationSkillsFieldProps) {
  const [filter, setFilter] = useState('');
  const query = useQuery({
    queryKey: ['new-conversation-skills', projectKey ?? '', issueId ?? ''],
    queryFn: () => fetchSkillRows(projectKey, issueId),
  });
  const rows = query.data;

  // Drop choices for skills the new context no longer lists.
  useEffect(() => {
    if (!rows) return;
    const listed = new Set(rows.map(row => row.id));
    const kept = Object.entries(value).filter(([id]) => listed.has(id));
    if (kept.length !== Object.keys(value).length) onChange(Object.fromEntries(kept));
  }, [rows, value, onChange]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (rows ?? []).filter(row => !needle || row.id.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle));
  }, [rows, filter]);

  const choose = (id: string, choice: boolean | null) => {
    const next = { ...value };
    if (choice === null) delete next[id];
    else next[id] = choice;
    onChange(next);
  };

  if (query.isLoading) return <p className={styles.note}>Loading skills…</p>;
  if (query.isError || !rows) return <p className={styles.note}>Skills unavailable</p>;

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
        {visible.map(row => {
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
                    onClick={() => choose(row.id, choice)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
