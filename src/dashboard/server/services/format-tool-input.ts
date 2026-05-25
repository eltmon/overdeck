/**
 * Per-tool collapsed-row summaries for the conversation transcript work log.
 *
 * The expanded body is rendered on the frontend from the raw `toolInput` dict
 * (see WorkLogEntry.toolInput). This helper produces only the short one-line
 * summary used in the collapsed row.
 */

const COLLAPSED_SUMMARY_MAX = 160;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function firstLine(value: string): string {
  const idx = value.indexOf('\n');
  return idx >= 0 ? value.slice(0, idx) : value;
}

function basename(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}

function truncate(value: string): string {
  return value.length > COLLAPSED_SUMMARY_MAX
    ? `${value.slice(0, COLLAPSED_SUMMARY_MAX - 1)}…`
    : value;
}

/**
 * Produce a human-readable one-line summary of a tool_use input dict for
 * display in the collapsed work-log row. Returns undefined if there is nothing
 * useful to show (caller leaves `detail` blank).
 */
export function summarizeToolInputForWorkLog(
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined;

  switch (toolName) {
    case 'Bash': {
      const description = asString(input.description);
      if (description) return truncate(description);
      const command = asString(input.command);
      if (command) return truncate(firstLine(command));
      return undefined;
    }

    case 'Read':
    case 'Write':
    case 'NotebookEdit': {
      const filePath = asString(input.file_path) ?? asString(input.notebook_path);
      return filePath ? truncate(basename(filePath)) : undefined;
    }

    case 'Edit': {
      const filePath = asString(input.file_path);
      return filePath ? truncate(basename(filePath)) : undefined;
    }

    case 'Grep': {
      const pattern = asString(input.pattern) ?? '';
      const path = asString(input.path);
      return truncate(path ? `"${pattern}" in ${basename(path)}` : `"${pattern}"`);
    }

    case 'Glob': {
      const pattern = asString(input.pattern) ?? '';
      return truncate(pattern);
    }

    case 'WebFetch': {
      const url = asString(input.url);
      return url ? truncate(url) : undefined;
    }

    case 'WebSearch': {
      const query = asString(input.query);
      return query ? truncate(`"${query}"`) : undefined;
    }

    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos : undefined;
      return todos ? `${todos.length} item${todos.length === 1 ? '' : 's'}` : undefined;
    }

    case 'Task': {
      const description = asString(input.description);
      const subagentType = asString(input.subagent_type);
      if (description && subagentType) return truncate(`${subagentType}: ${description}`);
      return description ? truncate(description) : subagentType;
    }

    default: {
      // MCP / unknown tools — show the first short string value if there is one,
      // otherwise leave blank and let the expanded view render JSON.
      for (const value of Object.values(input)) {
        if (typeof value === 'string' && value.length > 0) {
          return truncate(firstLine(value));
        }
      }
      return undefined;
    }
  }
}
