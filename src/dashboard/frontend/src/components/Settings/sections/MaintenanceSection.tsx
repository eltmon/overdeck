import { type QueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface MaintenanceSectionProps {
  clearingCache: boolean;
  queryClient: QueryClient;
  setClearingCache: (clearing: boolean) => void;
}

export function MaintenanceSection({
  clearingCache,
  queryClient,
  setClearingCache,
}: MaintenanceSectionProps) {
  return (
    <section id="maintenance" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">Maintenance</h2>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Issue cache</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Clear cached issue data and re-fetch from all trackers
            </p>
          </div>
          <button
            onClick={async () => {
              setClearingCache(true);
              try {
                const res = await fetch('/api/cache/clear', { method: 'POST' });
                if (!res.ok) throw new Error(await res.text());
                toast.success('Issue cache cleared and re-fetched');
                queryClient.invalidateQueries({ queryKey: ['issues'] });
              } catch (err: any) {
                toast.error(`Failed to clear cache: ${err.message}`);
              } finally {
                setClearingCache(false);
              }
            }}
            disabled={clearingCache}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:border-warning/50 hover:bg-warning/10 text-muted-foreground hover:text-warning transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            {clearingCache ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {clearingCache ? 'Clearing...' : 'Clear & Refresh'}
          </button>
        </div>
      </div>
    </section>
  );
}
