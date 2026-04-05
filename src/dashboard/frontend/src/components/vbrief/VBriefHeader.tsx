import type { VBriefDocument } from './types';

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-600 text-gray-100',
  proposed: 'bg-blue-800 text-blue-100',
  approved: 'bg-green-800 text-green-100',
  pending: 'bg-yellow-800 text-yellow-100',
  running: 'bg-blue-700 text-blue-100',
  completed: 'bg-green-700 text-green-100',
  blocked: 'bg-red-800 text-red-100',
  cancelled: 'bg-gray-700 text-gray-300',
};

function fmt(ts?: string): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

interface VBriefHeaderProps {
  doc: VBriefDocument;
}

export function VBriefHeader({ doc }: VBriefHeaderProps) {
  const { plan, vBRIEFInfo } = doc;
  const badgeCls = STATUS_BADGE[plan.status] ?? 'bg-gray-600 text-gray-100';

  return (
    <div className="p-4 border-b border-gray-700">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-white leading-tight">{plan.title}</h2>
        <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${badgeCls}`}>
          {plan.status}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-400">
        {plan.uid && (
          <div className="col-span-2">
            <span className="text-gray-500">uid </span>
            <span className="font-mono text-gray-300">{plan.uid}</span>
          </div>
        )}
        {plan.author && (
          <div>
            <span className="text-gray-500">author </span>
            <span className="text-gray-300">{plan.author}</span>
          </div>
        )}
        {vBRIEFInfo.author && (
          <div>
            <span className="text-gray-500">tool </span>
            <span className="text-gray-300">{vBRIEFInfo.author}</span>
          </div>
        )}
        {plan.created && (
          <div>
            <span className="text-gray-500">created </span>
            <span className="text-gray-300">{fmt(plan.created)}</span>
          </div>
        )}
        {plan.updated && (
          <div>
            <span className="text-gray-500">updated </span>
            <span className="text-gray-300">{fmt(plan.updated)}</span>
          </div>
        )}
        {plan.sequence !== undefined && (
          <div>
            <span className="text-gray-500">seq </span>
            <span className="text-gray-300">{plan.sequence}</span>
          </div>
        )}
      </div>
    </div>
  );
}
