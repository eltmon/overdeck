import { useState } from 'react';
import { ChevronDown, ChevronRight, Quote, X } from 'lucide-react';
import { removeCitation, updateCitationComment, useConversationCitations } from '../../../lib/composerCitations';
import type { PendingCitation } from '../../../lib/citationFormat';
import styles from '../../CommandDeck/styles/command-deck.module.css';

const QUOTE_EXCERPT_LIMIT = 80;
const COMMENT_EXCERPT_LIMIT = 60;

function excerpt(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

function CitationChip({ conversationName, citation }: { conversationName: string; citation: PendingCitation }) {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState(citation.comment);

  return (
    <div data-testid="composer-citation-chip" className={styles.composerImageCard}>
      <div className={styles.composerImageMeta}>
        <button
          type="button"
          aria-label={expanded ? 'Collapse citation' : 'Expand citation'}
          onClick={() => setExpanded((v) => !v)}
          className="border-0 bg-transparent p-0"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Quote size={14} />
        {expanded ? (
          <div className="flex flex-1 flex-col gap-1.5">
            {citation.source.kind === 'file' && (
              <div className="text-muted-foreground">{citation.source.path}</div>
            )}
            <blockquote className="border-border border-l-2 bg-muted/30 pl-2 text-muted-foreground">
              {citation.quotedText}
            </blockquote>
            <textarea
              aria-label="Edit citation comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              className="border-border bg-muted/30 text-muted-foreground"
            />
            <button type="button" onClick={() => updateCitationComment(conversationName, citation.id, comment)}>
              Save
            </button>
          </div>
        ) : (
          <span className={styles.composerImageName}>
            {citation.source.kind === 'file' && (
              <span className={styles.composerImageStatus}>{basename(citation.source.path)} · </span>
            )}
            {excerpt(citation.quotedText, QUOTE_EXCERPT_LIMIT)}
            {citation.comment && (
              <span className={styles.composerImageStatus}> · {excerpt(citation.comment, COMMENT_EXCERPT_LIMIT)}</span>
            )}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label="Remove citation"
        className={styles.composerImageRemoveButton}
        onClick={() => removeCitation(conversationName, citation.id)}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function CitationChips({ conversationName }: { conversationName: string }) {
  const citations = useConversationCitations(conversationName);
  if (citations.length === 0) return null;

  return (
    <div data-testid="composer-citation-chips" className={styles.composerImageStrip}>
      {citations.map((citation) => (
        <CitationChip key={citation.id} conversationName={conversationName} citation={citation} />
      ))}
    </div>
  );
}
