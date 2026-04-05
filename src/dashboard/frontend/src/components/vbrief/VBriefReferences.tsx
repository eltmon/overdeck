import { ExternalLink } from 'lucide-react';
import type { VBriefReference } from './types';

interface VBriefReferencesProps {
  references: VBriefReference[];
}

export function VBriefReferences({ references }: VBriefReferencesProps) {
  if (references.length === 0) return null;

  return (
    <div className="p-4 border-b border-gray-700">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">References</h3>
      <ul className="space-y-1">
        {references.map((ref, i) => (
          <li key={i} className="flex items-center gap-1.5 text-sm">
            {ref.type && (
              <span className="text-xs text-gray-500 shrink-0">[{ref.type}]</span>
            )}
            <a
              href={ref.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate"
            >
              {ref.label ?? ref.uri}
              <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
