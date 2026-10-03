/**
 * Linked-issue picker for the new-conversation options dialog (PAN-4486).
 * D10: it filters the dashboard store's issues client-side by a
 * case-insensitive substring of the identifier or title, showing the first 20.
 * The chosen identifier becomes the create request's `issueId`.
 */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { selectIssues, useDashboardStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import type { Issue } from '../../types';
import styles from './IssuePickerField.module.css';

const MAX_MATCHES = 20;

export interface IssuePickerFieldProps {
  value: string | null;
  onChange: (id: string | null) => void;
}

export function IssuePickerField({ value, onChange }: IssuePickerFieldProps) {
  const issues = useDashboardStore(selectIssues) as Issue[];
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return issues
      .filter(issue => !needle || issue.identifier.toLowerCase().includes(needle) || (issue.title ?? '').toLowerCase().includes(needle))
      .slice(0, MAX_MATCHES);
  }, [issues, text]);

  if (value) {
    const selected = issues.find(issue => issue.identifier === value);
    return (
      <div className={styles.selected}>
        <span className={styles.selectedText}>{selected ? `${value} — ${selected.title}` : value}</span>
        <button type="button" className={styles.clear} aria-label="Clear linked issue" onClick={() => onChange(null)}>
          <X size={12} />
        </button>
      </div>
    );
  }

  const select = (issue: Issue | undefined) => {
    if (!issue) return;
    onChange(issue.identifier);
    setText('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive(index => Math.min(index + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      select(matches[active]);
    }
  };

  const listId = 'issue-picker-listbox';
  return (
    <div className={styles.picker}>
      <input
        type="text"
        role="combobox"
        aria-label="Link to an issue"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={styles.input}
        placeholder="Search issues"
        value={text}
        onChange={event => {
          setText(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className={styles.list}>
          {matches.map((issue, index) => (
            <li
              key={issue.identifier}
              role="option"
              aria-selected={index === active}
              className={cn(styles.option, index === active && styles.optionActive)}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={event => {
                event.preventDefault();
                select(issue);
              }}
            >
              <span className={styles.identifier}>{issue.identifier}</span>
              <span className={styles.title}>{issue.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
