import type { CitationSource } from '../../../lib/citationFormat';

export interface ResolvedSelectionCitation {
  messageId: string;
  role: 'assistant' | 'user';
  quotedText: string;
}

export type MinimalSelection = Pick<Selection, 'isCollapsed' | 'anchorNode' | 'focusNode' | 'toString'>;

export interface SelectionCitation {
  source: CitationSource;
  quotedText: string;
}

export type SelectionCitationResolver = (selection: MinimalSelection) => SelectionCitation | null;

function findCiteElement(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  return element?.closest<HTMLElement>('[data-cite-message-id]') ?? null;
}

export function resolveSelectionCitation(selection: MinimalSelection | null): ResolvedSelectionCitation | null {
  if (!selection || selection.isCollapsed) return null;

  const quotedText = selection.toString().trim();
  if (quotedText === '') return null;

  const anchorElement = findCiteElement(selection.anchorNode);
  const focusElement = findCiteElement(selection.focusNode);
  if (!anchorElement || !focusElement || anchorElement !== focusElement) return null;

  const messageId = anchorElement.getAttribute('data-cite-message-id');
  const role = anchorElement.getAttribute('data-cite-role');
  if (!messageId || (role !== 'assistant' && role !== 'user')) return null;

  return { messageId, role, quotedText };
}

export const resolveMessageSelection: SelectionCitationResolver = (selection) => {
  const resolved = resolveSelectionCitation(selection);
  return resolved
    ? { source: { kind: 'message', messageId: resolved.messageId, role: resolved.role }, quotedText: resolved.quotedText }
    : null;
};

export function fileSelectionResolver(path: string): SelectionCitationResolver {
  return (selection) => {
    if (selection.isCollapsed) return null;
    const quotedText = selection.toString().trim();
    return quotedText === '' ? null : { source: { kind: 'file', path }, quotedText };
  };
}
