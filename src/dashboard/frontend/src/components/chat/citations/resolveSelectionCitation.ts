export interface ResolvedSelectionCitation {
  messageId: string;
  role: 'assistant' | 'user';
  quotedText: string;
}

type MinimalSelection = Pick<Selection, 'isCollapsed' | 'anchorNode' | 'focusNode' | 'toString'>;

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
