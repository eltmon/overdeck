/**
 * Facet filter panel for session list (PAN-457)
 */

interface Filters {
  source?: 'all' | 'discovered' | 'managed-archived';
  harness?: string;
  workspace?: string;
  since?: string;
  managed?: boolean;
  enriched?: boolean;
  model?: string;
  tag?: string;
  tool?: string;
  file?: string;
  minCost?: string;
  maxCost?: string;
  enrichmentLevel?: string;
}

interface FacetValue {
  value: string;
  count: number;
  label?: string;
  cost?: number;
  minCost?: string;
  maxCost?: string;
}

interface Props {
  filters: Filters;
  facets: {
    harnesses: FacetValue[];
    models: FacetValue[];
    workspaces: FacetValue[];
    tags: FacetValue[];
    tools: FacetValue[];
    files: FacetValue[];
    timeRanges: FacetValue[];
    costRanges: FacetValue[];
    enrichmentLevels: FacetValue[];
  };
  onChange: (key: string, value: string | boolean | undefined) => void;
}

const SINCE_OPTIONS = [
  { label: 'All time', value: '' },
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
];

const SOURCE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Discovered', value: 'discovered' },
  { label: 'Managed-archived', value: 'managed-archived' },
] as const;

export function FacetPanel({ filters, facets, onChange }: Props) {
  const showHarnesses = facets.harnesses.some((harness) => harness.value !== 'claude-code');

  return (
    <div className="w-48 shrink-0 border-r border-border bg-background p-3 overflow-auto">
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Filters
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Source</label>
        <div className="flex flex-wrap gap-1">
          {SOURCE_OPTIONS.map((source) => {
            const active = (filters.source ?? 'all') === source.value;
            return (
              <button
                key={source.value}
                onClick={() => onChange('source', source.value === 'all' ? undefined : source.value)}
                className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {source.label}
              </button>
            );
          })}
        </div>
      </div>

      {showHarnesses && (
        <div className="mb-4">
          <label className="text-xs text-muted-foreground block mb-1">Harness</label>
          <div className="flex flex-wrap gap-1">
            {facets.harnesses.map((harness) => (
              <button
                key={harness.value}
                onClick={() => onChange('harness', filters.harness === harness.value ? undefined : harness.value)}
                className={`px-1.5 py-0.5 text-[10px] font-mono transition-colors ${
                  filters.harness === harness.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground'
                }`}
                title={harness.value}
              >
                {harness.value}: {harness.count}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Time range */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Time range</label>
        <select
          value={filters.since ?? ''}
          onChange={(e) => onChange('since', e.target.value || undefined)}
          className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
        >
          {SINCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="mt-2 flex flex-wrap gap-1">
          {facets.timeRanges.map((range) => (
            <button
              key={range.value}
              onClick={() => onChange('since', filters.since === range.value ? undefined : range.value)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                filters.since === range.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {range.label ?? range.value}: {range.count}
            </button>
          ))}
        </div>
      </div>

      {/* Workspace filter */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Workspace path</label>
        <input
          type="text"
          list="conversation-workspaces"
          value={filters.workspace ?? ''}
          onChange={(e) => onChange('workspace', e.target.value || undefined)}
          placeholder="e.g. /Projects/myapp"
          className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary"
        />
        <datalist id="conversation-workspaces">
          {facets.workspaces.map((workspace) => <option key={workspace.value} value={workspace.value} />)}
        </datalist>
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Model</label>
        <select
          value={filters.model ?? ''}
          onChange={(e) => onChange('model', e.target.value || undefined)}
          className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
        >
          <option value="">All models</option>
          {facets.models.map((model) => <option key={model.value} value={model.value}>{model.value} ({model.count})</option>)}
        </select>
        <div className="mt-2 space-y-1 max-h-24 overflow-auto">
          {facets.models.slice(0, 8).map((model) => (
            <button
              key={model.value}
              onClick={() => onChange('model', filters.model === model.value ? undefined : model.value)}
              className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] transition-colors ${
                filters.model === model.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
              title={model.value}
            >
              {model.count} · {model.value}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Tag</label>
        <input
          type="text"
          list="conversation-tags"
          value={filters.tag ?? ''}
          onChange={(e) => onChange('tag', e.target.value || undefined)}
          placeholder="e.g. bugfix"
          className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary"
        />
        <datalist id="conversation-tags">
          {facets.tags.map((tag) => <option key={tag.value} value={tag.value} />)}
        </datalist>
        <div className="mt-2 flex flex-wrap gap-1 max-h-20 overflow-auto">
          {facets.tags.slice(0, 12).map((tag) => (
            <button
              key={tag.value}
              onClick={() => onChange('tag', filters.tag === tag.value ? undefined : tag.value)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                filters.tag === tag.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
              title={tag.value}
            >
              {tag.value}: {tag.count}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">Tool</label>
        <input
          type="text"
          list="conversation-tools"
          value={filters.tool ?? ''}
          onChange={(e) => onChange('tool', e.target.value || undefined)}
          placeholder="e.g. Read"
          className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary"
        />
        <datalist id="conversation-tools">
          {facets.tools.map((tool) => <option key={tool.value} value={tool.value} />)}
        </datalist>
        <div className="mt-2 flex flex-wrap gap-1 max-h-20 overflow-auto">
          {facets.tools.slice(0, 12).map((tool) => (
            <button
              key={tool.value}
              onClick={() => onChange('tool', filters.tool === tool.value ? undefined : tool.value)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                filters.tool === tool.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
              title={tool.value}
            >
              {tool.value}: {tool.count}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="text-xs text-muted-foreground block mb-1">File touched</label>
        <input
          type="text"
          list="conversation-files"
          value={filters.file ?? ''}
          onChange={(e) => onChange('file', e.target.value || undefined)}
          placeholder="e.g. src/index.ts"
          className="w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary"
        />
        <datalist id="conversation-files">
          {facets.files.map((file) => <option key={file.value} value={file.value} />)}
        </datalist>
        <div className="mt-2 space-y-1 max-h-24 overflow-auto">
          {facets.files.slice(0, 8).map((file) => (
            <button
              key={file.value}
              onClick={() => onChange('file', filters.file === file.value ? undefined : file.value)}
              className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] transition-colors ${
                filters.file === file.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
              title={file.value}
            >
              {file.count} · {file.value}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-xs text-muted-foreground block mb-1">Workspace cost</div>
        <div className="space-y-1 max-h-24 overflow-auto">
          {facets.workspaces.slice(0, 8).map((workspace) => (
            <button
              key={workspace.value}
              onClick={() => onChange('workspace', workspace.value)}
              className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground truncate"
              title={workspace.value}
            >
              {workspace.count} · ${(workspace.cost ?? 0).toFixed(4)} · {workspace.value}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-xs text-muted-foreground block mb-1">Cost ranges</div>
        <div className="flex flex-wrap gap-1">
          {facets.costRanges.map((range) => (
            <button
              key={range.value}
              onClick={() => {
                const active = filters.minCost === range.minCost && filters.maxCost === range.maxCost;
                onChange('minCost', active ? undefined : range.minCost);
                onChange('maxCost', active ? undefined : range.maxCost);
              }}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                filters.minCost === range.minCost && filters.maxCost === range.maxCost
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
              title={`Estimated total $${(range.cost ?? 0).toFixed(4)}`}
            >
              {range.label ?? range.value}: {range.count}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-xs text-muted-foreground block mb-1">Enrichment levels</div>
        <div className="flex flex-wrap gap-1">
          {facets.enrichmentLevels.map((level) => (
            <button
              key={level.value}
              onClick={() => onChange('enrichmentLevel', filters.enrichmentLevel === level.value ? undefined : level.value)}
              className={`rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                filters.enrichmentLevel === level.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              L{level.value}: {level.count}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground block">
          Min cost
          <input
            type="number"
            step="0.001"
            value={filters.minCost ?? ''}
            onChange={(e) => onChange('minCost', e.target.value || undefined)}
            className="mt-1 w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
          />
        </label>
        <label className="text-xs text-muted-foreground block">
          Max cost
          <input
            type="number"
            step="0.001"
            value={filters.maxCost ?? ''}
            onChange={(e) => onChange('maxCost', e.target.value || undefined)}
            className="mt-1 w-full bg-card border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary"
          />
        </label>
      </div>

      {/* Toggle filters */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.managed === true}
            onChange={(e) => onChange('managed', e.target.checked ? true : undefined)}
            className="rounded border-border bg-muted text-primary focus:ring-0"
          />
          <span className="text-xs text-muted-foreground">Overdeck-managed</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.enriched === true}
            onChange={(e) => onChange('enriched', e.target.checked ? true : undefined)}
            className="rounded border-border bg-muted text-primary focus:ring-0"
          />
          <span className="text-xs text-muted-foreground">Enriched only</span>
        </label>
      </div>

      {/* Reset */}
      {Object.values(filters).some(Boolean) && (
        <button
          onClick={() => {
            onChange('since', undefined);
            onChange('harness', undefined);
            onChange('workspace', undefined);
            onChange('managed', undefined);
            onChange('enriched', undefined);
            onChange('model', undefined);
            onChange('tag', undefined);
            onChange('tool', undefined);
            onChange('file', undefined);
            onChange('minCost', undefined);
            onChange('maxCost', undefined);
            onChange('enrichmentLevel', undefined);
          }}
          className="mt-4 text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
