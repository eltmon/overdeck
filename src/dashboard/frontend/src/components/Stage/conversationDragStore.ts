/**
 * conversationDragStore — the conversation row being dragged, if any
 * (PAN-5343 H-D8).
 *
 * The conversation list sets it on dragstart and clears it on dragend. The
 * Stage reads it to decide whether its panes show the drop overlay: in the
 * All projects deck for any conversation, in a project deck only for that
 * deck's own conversations. `deckKey` is the conversation's own project deck.
 */
import { create } from 'zustand'

export interface ConversationDrag {
  name: string
  deckKey: string
}

interface ConversationDragStore {
  dragging: ConversationDrag | null
  start(drag: ConversationDrag): void
  end(): void
}

export const useConversationDragStore = create<ConversationDragStore>((set) => ({
  dragging: null,
  start: (drag) => set({ dragging: drag }),
  end: () => set({ dragging: null }),
}))

/** The drag data type a conversation row carries. */
export const CONVERSATION_DRAG_TYPE = 'application/x-conversation-name'
