/**
 * The New Workspace name field, with suggestions (PAN-4281 FR-12, D12, D22).
 *
 * What is typed is still the workspace name. On top of that the field offers,
 * in order: "Open <ID> and start work" for an issue reference, each branch
 * whose name matches (sets the parent branch), and a slugged name when the
 * text is not a valid name as typed. Nothing is highlighted until an arrow key
 * moves into the list, so a plain Enter still submits the form, except when
 * the text is an issue or cannot be a name, where the first row is the answer.
 */

import { useId, useMemo, useState, type RefObject } from 'react';
import { classifySmartInput, toWorkspaceSlug } from './smartField';

const VALID_NAME = /^[a-zA-Z0-9-]+$/;

type SmartRow =
  | { kind: 'issue'; id: string }
  | { kind: 'branch'; branch: string }
  | { kind: 'name'; slug: string };

interface SmartWorkspaceFieldProps {
  value: string;
  onChange: (text: string) => void;
  inputRef?: RefObject<HTMLInputElement>;
  /** Registered issue prefixes, for recognizing `PAN-12`. */
  prefixes: string[];
  /** The selected project's prefix, which turns `#12` into `PAN-12`. */
  projectPrefix: string | null;
  branchCandidates: string[];
  onOpenIssue: (id: string) => void;
  onPickBranch: (branch: string) => void;
  onUseName: (slug: string) => void;
}

function rowLabel(row: SmartRow): string {
  if (row.kind === 'issue') return `Open ${row.id} and start work`;
  if (row.kind === 'branch') return `Start from branch ${row.branch}`;
  return `Use "${row.slug}" as the name`;
}

export function SmartWorkspaceField({
  value,
  onChange,
  inputRef,
  prefixes,
  projectPrefix,
  branchCandidates,
  onOpenIssue,
  onPickBranch,
  onUseName,
}: SmartWorkspaceFieldProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const classified = useMemo(() => classifySmartInput(value, prefixes), [value, prefixes]);
  const rows = useMemo(() => {
    const next: SmartRow[] = [];
    const rawId = classified.kind === 'issue' || classified.kind === 'url' ? classified.id : undefined;
    // A bare #12 needs the selected project's prefix to name an issue.
    const issueId = rawId?.startsWith('#') ? (projectPrefix ? `${projectPrefix}-${rawId.slice(1)}` : undefined) : rawId;
    if (issueId) next.push({ kind: 'issue', id: issueId });
    for (const branch of branchCandidates) next.push({ kind: 'branch', branch });
    const slug = toWorkspaceSlug(value);
    if (classified.kind === 'text' && slug && slug !== value.trim()) next.push({ kind: 'name', slug });
    return next;
  }, [branchCandidates, classified, projectPrefix, value]);

  const showList = open && value.trim().length > 0 && rows.length > 0;
  // An issue, or text that cannot be a name, has one obvious answer; otherwise
  // Enter keeps submitting the form until the operator arrows into the list.
  const defaultHighlight = rows[0]?.kind === 'issue' || !VALID_NAME.test(value.trim()) ? 0 : -1;
  const active = highlight >= 0 ? highlight : defaultHighlight;

  const pick = (row: SmartRow) => {
    setOpen(false);
    setHighlight(-1);
    if (row.kind === 'issue') onOpenIssue(row.id);
    else if (row.kind === 'branch') onPickBranch(row.branch);
    else onUseName(row.slug);
  };

  return (
    <div className="relative mb-7">
      <input
        ref={inputRef}
        data-testid="new-workspace-hero-title"
        data-region="hero-title"
        aria-label="Workspace name"
        aria-autocomplete="list"
        aria-controls={showList ? listId : undefined}
        aria-expanded={showList}
        className="display-xl w-full border-0 bg-transparent p-0 text-foreground caret-primary outline-none placeholder:text-muted-foreground/40"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!showList || event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight(Math.min(active + 1, rows.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight(Math.max(active - 1, 0));
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === 'Enter' && active >= 0 && rows[active]) {
            event.preventDefault();
            pick(rows[active]);
          }
        }}
        placeholder="Untitled workspace"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute left-0 top-full z-20 mt-1 min-w-80 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {rows.map((row, index) => (
            <div
              key={`${row.kind}-${row.kind === 'issue' ? row.id : row.kind === 'branch' ? row.branch : row.slug}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => {
                event.preventDefault(); // keep input focus
                pick(row);
              }}
              className={`cursor-pointer rounded-md px-3 py-2 text-sm text-popover-foreground ${index === active ? 'bg-accent' : ''}`}
            >
              {row.kind === 'branch' ? (
                <>
                  Start from branch <span className="font-mono">{row.branch}</span>
                </>
              ) : (
                rowLabel(row)
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
