import { useState } from 'react';
import { ChevronDown, ChevronRight, Circle, Wrench } from 'lucide-react';
import type { WorkLogEntry } from '../chat-types';
import { ChatMarkdown } from '../ChatMarkdown';
import styles from '../../CommandDeck/styles/command-deck.module.css';
import { MAX_VISIBLE_WORK_LOG_ENTRIES } from './helpers';

export function WorkLogGroup({ entries, hideToolCalls, cwd, issueId }: { entries: WorkLogEntry[]; hideToolCalls?: boolean; cwd?: string; issueId?: string | null }) {
  const [expanded, setExpanded] = useState(false);

  const onlyToolEntries = entries.every((entry) => entry.tone === 'tool' || entry.tone === 'error');
  if (hideToolCalls && onlyToolEntries && !expanded) {
    const n = entries.length;
    return (
      <button
        type="button"
        className={styles.workLogGroup}
        onClick={() => setExpanded(true)}
        title={`Show ${n} tool ${n === 1 ? 'call' : 'calls'}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          opacity: 0.5,
          fontSize: 11,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.85'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'; }}
      >
        <Wrench size={12} />
        <span>{n} tool {n === 1 ? 'call was' : 'calls were'} made</span>
      </button>
    );
  }

  const visible = expanded ? entries : entries.slice(0, MAX_VISIBLE_WORK_LOG_ENTRIES);
  const hasOverflow = entries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;

  return (
    <div className={styles.workLogGroup}>
      {visible.map((entry) => (
        <SimpleWorkEntryRow key={entry.id} entry={entry} cwd={cwd} issueId={issueId} />
      ))}
      {hasOverflow && !expanded && (
        <button
          className={styles.workLogExpandBtn}
          onClick={() => setExpanded(true)}
        >
          <ChevronRight size={12} />
          Show {entries.length - MAX_VISIBLE_WORK_LOG_ENTRIES} more
        </button>
      )}
      {expanded && (
        <button
          className={styles.workLogExpandBtn}
          onClick={() => setExpanded(false)}
        >
          <ChevronDown size={12} />
          Collapse
        </button>
      )}
    </div>
  );
}

const TERMINAL_TOOLS = new Set(['Bash', 'bash', 'Shell', 'terminal', 'shell']);
const WORK_LOG_DETAIL_MAX = 80;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function firstLine(value: string): string {
  const idx = value.indexOf('\n');
  return idx >= 0 ? value.slice(0, idx) : value;
}

function getWorkLogDisplayDetail(entry: WorkLogEntry): string | undefined {
  const detail = entry.detail ?? entry.command;
  return detail ? firstLine(detail) : undefined;
}

/**
 * Per-tool expanded body for a tool_use work-log entry. Reads structured
 * fields out of `entry.toolInput` and renders them in a form that matches
 * the tool's semantics (shell block for Bash, file chip for Read/Write/Edit,
 * pattern + path for Grep/Glob, etc.). Unknown tools fall back to a
 * pretty-printed JSON code block. See PAN-1459.
 */
function ToolUseExpanded({
  entry,
  cwd,
  issueId,
}: {
  entry: WorkLogEntry;
  cwd?: string;
  issueId?: string | null;
}) {
  const tool = entry.toolTitle ?? entry.label;
  const input = entry.toolInput;
  if (!input) return null;

  switch (tool) {
    case 'Bash': {
      const description = asString(input.description);
      const command = asString(input.command);
      return (
        <>
          {description && <div className={styles.workLogToolHeader}>{description}</div>}
          {command && (
            <pre className={styles.workLogResult}>
              <code>{command}</code>
            </pre>
          )}
        </>
      );
    }

    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const filePath = asString(input.file_path) ?? asString(input.notebook_path);
      if (!filePath) break;
      return (
        <div className={styles.workLogResult}>
          <ChatMarkdown text={`\`${filePath}\``} cwd={cwd} issueId={issueId} />
        </div>
      );
    }

    case 'Grep': {
      const pattern = asString(input.pattern) ?? '';
      const path = asString(input.path);
      const glob = asString(input.glob);
      const flags = [
        asString(input.type) && `type=${input.type}`,
        input['-i'] === true && 'case-insensitive',
        input['-n'] === true && 'line-numbers',
        glob && `glob=${glob}`,
      ].filter(Boolean);
      return (
        <div className={styles.workLogResult}>
          <code>{pattern}</code>
          {path && <> in <code>{path}</code></>}
          {flags.length > 0 && <> · {flags.join(' · ')}</>}
        </div>
      );
    }

    case 'Glob': {
      const pattern = asString(input.pattern) ?? '';
      const path = asString(input.path);
      return (
        <div className={styles.workLogResult}>
          <code>{pattern}</code>
          {path && <> in <code>{path}</code></>}
        </div>
      );
    }

    case 'WebFetch': {
      const url = asString(input.url);
      const prompt = asString(input.prompt);
      return (
        <div className={styles.workLogResult}>
          {url && (
            <div>
              <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
            </div>
          )}
          {prompt && <div>{prompt}</div>}
        </div>
      );
    }

    case 'WebSearch': {
      const query = asString(input.query);
      return query ? <div className={styles.workLogResult}>{query}</div> : null;
    }

    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return (
        <ul className={styles.workLogResult}>
          {todos.map((todo, i) => {
            const t = todo as Record<string, unknown>;
            const content = asString(t.content) ?? asString(t.activeForm) ?? '(empty)';
            const status = asString(t.status) ?? 'pending';
            return (
              <li key={i}>
                <span style={{ color: 'var(--muted-foreground)' }}>[{status}]</span> {content}
              </li>
            );
          })}
        </ul>
      );
    }

    case 'Task': {
      const subagent = asString(input.subagent_type);
      const description = asString(input.description);
      const prompt = asString(input.prompt);
      return (
        <div className={styles.workLogResult}>
          {(subagent || description) && (
            <div className={styles.workLogToolHeader}>
              {subagent && <code>{subagent}</code>}
              {subagent && description && ' · '}
              {description}
            </div>
          )}
          {prompt && <ChatMarkdown text={prompt} cwd={cwd} issueId={issueId} />}
        </div>
      );
    }

    // ─── Pi harness (lowercase tool names; `path`/`command`/`edits` keys) ────
    case 'bash': {
      const description = asString(input.description);
      const command = asString(input.command);
      return (
        <>
          {description && <div className={styles.workLogToolHeader}>{description}</div>}
          {command && (
            <pre className={styles.workLogResult}>
              <code>{command}</code>
            </pre>
          )}
        </>
      );
    }

    case 'read':
    case 'write': {
      const filePath = asString(input.path) ?? asString(input.file_path);
      if (!filePath) break;
      return (
        <div className={styles.workLogResult}>
          <ChatMarkdown text={`\`${filePath}\``} cwd={cwd} issueId={issueId} />
        </div>
      );
    }

    case 'edit': {
      const filePath = asString(input.path) ?? asString(input.file_path);
      if (!filePath) break;
      const edits = Array.isArray(input.edits) ? input.edits.length : 0;
      return (
        <div className={styles.workLogResult}>
          <ChatMarkdown text={`\`${filePath}\`${edits > 1 ? ` \u00b7 ${edits} edits` : ''}`} cwd={cwd} issueId={issueId} />
        </div>
      );
    }

    default:
      break;
  }

  // Fallback: pretty-printed JSON. Replaces the previous behavior of stuffing
  // JSON.stringify(input) into a one-line `detail` string with no formatting.
  return (
    <pre className={styles.workLogResult}>
      <code>{JSON.stringify(input, null, 2)}</code>
    </pre>
  );
}

function SimpleWorkEntryRow({ entry, cwd, issueId }: { entry: WorkLogEntry; cwd?: string; issueId?: string | null }) {
  const [showResult, setShowResult] = useState(false);
  const toneColor: Record<WorkLogEntry['tone'], string> = {
    thinking: 'var(--muted-foreground)',
    tool: 'var(--primary)',
    info: 'var(--success)',
    error: 'var(--destructive)',
  };

  const isTerminal = TERMINAL_TOOLS.has(entry.toolTitle ?? entry.label);
  const isThinking = entry.tone === 'thinking';
  const hasResult = !!entry.result;
  const hasToolBody = !!entry.toolInput && (entry.tone === 'tool' || entry.tone === 'error');
  const isExpandable = hasResult || hasToolBody || (isThinking && !!entry.detail);
  const displayDetail = getWorkLogDisplayDetail(entry);

  return (
    <div>
      <div
        className={styles.workLogEntry}
        style={isExpandable ? { cursor: 'pointer' } : undefined}
        onClick={isExpandable ? () => setShowResult(prev => !prev) : undefined}
      >
        {isTerminal ? (
          <span
            className={styles.workLogTerminalIcon}
            style={{ color: toneColor[entry.tone] }}
          >
            {'>_'}
          </span>
        ) : (
          <Circle
            size={6}
            style={{
              fill: toneColor[entry.tone],
              color: toneColor[entry.tone],
              flexShrink: 0,
              marginTop: 2,
            }}
          />
        )}
        <span className={styles.workLogLabel}>{entry.toolTitle ?? entry.label}</span>
        {displayDetail && (
          <span className={styles.workLogDetail} title={displayDetail}>
            {displayDetail.slice(0, WORK_LOG_DETAIL_MAX)}
            {displayDetail.length > WORK_LOG_DETAIL_MAX ? '…' : ''}
          </span>
        )}
        {isExpandable && (
          <ChevronRight
            size={10}
            style={{
              flexShrink: 0,
              marginLeft: 'auto',
              transition: 'transform 0.15s',
              transform: showResult ? 'rotate(90deg)' : 'none',
              color: 'var(--muted-foreground)',
            }}
          />
        )}
      </div>
      {showResult && (
        <>
          {hasToolBody && <ToolUseExpanded entry={entry} cwd={cwd} issueId={issueId} />}
          {isThinking && entry.detail && (
            <div className={styles.workLogResult}>
              <ChatMarkdown text={entry.detail} cwd={cwd} issueId={issueId} />
            </div>
          )}
          {entry.result && (
            isTerminal ? (
              <pre className={styles.workLogResult}>{entry.result}</pre>
            ) : (
              <div className={styles.workLogResult}>
                <ChatMarkdown text={entry.result} cwd={cwd} issueId={issueId} />
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
