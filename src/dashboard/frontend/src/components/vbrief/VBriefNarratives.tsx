import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { VBriefPlan } from './types';

const NARRATIVE_ORDER = ['Problem', 'Proposal', 'Constraint', 'Risk', 'Alternative'];

interface VBriefNarrativesProps {
  narratives: VBriefPlan['narratives'];
}

export function VBriefNarratives({ narratives }: VBriefNarrativesProps) {
  if (!narratives) return null;

  const sections = [
    ...NARRATIVE_ORDER.filter(k => narratives[k]),
    ...Object.keys(narratives).filter(k => !NARRATIVE_ORDER.includes(k) && narratives[k]),
  ];

  if (sections.length === 0) return null;

  return (
    <div className="p-4 border-b border-border space-y-4">
      {sections.map(key => (
        <div key={key}>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{key}</h3>
          <div className="prose prose-invert prose-sm max-w-none text-muted-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {narratives[key]!}
            </ReactMarkdown>
          </div>
        </div>
      ))}
    </div>
  );
}
