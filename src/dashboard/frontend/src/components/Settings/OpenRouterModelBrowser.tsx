import { useState, useMemo } from 'react';
import { Search, Star, StarOff, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface OpenRouterModel {
  id: string;
  name: string;
  promptCostPer1M: number;
  completionCostPer1M: number;
  contextLength: number;
  supportsThinking: boolean;
  category: 'free' | 'chat' | 'code' | 'other';
  topProvider?: string;
}

type CategoryFilter = 'all' | 'free' | 'chat' | 'code';

interface OpenRouterModelBrowserProps {
  models: OpenRouterModel[];
  favorites: string[];
  loading?: boolean;
  onToggleFavorite: (modelId: string) => void;
}

function formatCost(costPer1M: number): string {
  if (costPer1M === 0) return 'Free';
  if (costPer1M < 0.01) return `$${(costPer1M * 1000).toFixed(3)}/B`;
  if (costPer1M < 1) return `$${costPer1M.toFixed(3)}/M`;
  return `$${costPer1M.toFixed(2)}/M`;
}

function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function ModelCard({
  model,
  isFavorite,
  onToggleFavorite,
}: {
  model: OpenRouterModel;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const isFree = model.category === 'free' || (model.promptCostPer1M === 0 && model.completionCostPer1M === 0);
  const avgCost = (model.promptCostPer1M + model.completionCostPer1M) / 2;

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg border transition-colors',
        isFavorite
          ? 'badge-bg-warning border-warning/30'
          : 'bg-card border-border hover:border-ring'
      )}
    >
      {/* Star button */}
      <button
        onClick={() => onToggleFavorite(model.id)}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        className={cn(
          'mt-0.5 flex-shrink-0 transition-colors',
          isFavorite ? 'text-warning hover:text-warning/80' : 'text-muted-foreground hover:text-warning'
        )}
      >
        {isFavorite ? <Star className="size-4 fill-current" /> : <StarOff className="size-4" />}
      </button>

      {/* Model info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground truncate">{model.name}</span>
          {model.supportsThinking && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider badge-bg-signal-review text-signal-review-foreground border badge-border-signal-review flex-shrink-0">
              Thinking
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 truncate font-mono">{model.id}</div>

        {/* Metrics row */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {isFree ? (
            <span className="text-xs font-bold text-success-foreground badge-bg-success px-1.5 py-0.5 rounded border badge-border-success">
              FREE
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              <span className="text-muted-foreground">{formatCost(avgCost)}</span> avg/1M tokens
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            <span className="text-muted-foreground">{formatContextLength(model.contextLength)}</span> ctx
          </span>
          {model.topProvider && (
            <span className="text-xs text-muted-foreground">{model.topProvider}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function OpenRouterModelBrowser({
  models,
  favorites,
  loading,
  onToggleFavorite,
}: OpenRouterModelBrowserProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const favoriteModels = useMemo(
    () => models.filter((m) => favoriteSet.has(m.id)),
    [models, favoriteSet]
  );

  const filteredModels = useMemo(() => {
    let result = models.filter((m) => !favoriteSet.has(m.id));

    if (categoryFilter !== 'all') {
      result = result.filter((m) => {
        if (categoryFilter === 'free') {
          return m.category === 'free' || (m.promptCostPer1M === 0 && m.completionCostPer1M === 0);
        }
        return m.category === categoryFilter;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
      );
    }

    return result;
  }, [models, favoriteSet, categoryFilter, search]);

  const categories: { id: CategoryFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'free', label: 'Free' },
    { id: 'chat', label: 'Chat' },
    { id: 'code', label: 'Code' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Loading model catalog...</span>
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No models available. Add your OpenRouter API key to browse the model catalog.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Favorites section */}
      {favoriteModels.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Star className="size-3 fill-warning text-warning" />
            Favorites ({favoriteModels.length})
          </h4>
          <div className="space-y-2">
            {favoriteModels.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                isFavorite={true}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-border rounded-md pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-accent-muted"
          />
        </div>
        <div className="flex gap-1">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={cn(
                'px-3 py-1.5 rounded text-xs font-medium transition-colors',
                categoryFilter === cat.id
                  ? 'bg-primary/10 text-accent border border-accent/40'
                  : 'bg-card text-muted-foreground border border-border hover:border-ring hover:text-muted-foreground'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* All models list */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          All Models ({filteredModels.length})
        </h4>
        {filteredModels.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground text-sm">
            No models match your search.
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {filteredModels.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                isFavorite={false}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
