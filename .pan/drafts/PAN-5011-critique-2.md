plan-digest: aac8c78982c61b8cb8ce356748a9190bd033b49446061c0ebdfe06c3b5002795

## blocks-the-design: Cockpit renders restarted panes as duplicate agent rows

W5b changes `paneToSession` to use `pane.agentId` as `sessionId`, but `cockpitSessions` still maps every pane separately (`src/dashboard/frontend/src/components/Stage/cockpit/IssueTreeLane.tsx:209-216`). A restarted Herdr agent can have an exited pane beside its live pane; `indexPanesByAgentKey` already documents and resolves that case (`packages/contracts/src/backend-pane.ts:40-50`, with both input orders tested in `packages/contracts/src/__tests__/backend-pane.test.ts:33-45`). The proposed merge would give both rows the same `sessionId`; `AgentsLane.tsx:307-314` then gives them the same React key and marks both selected, while one row remains `ended`. Deduplicate panes by agent key with the existing live-pane preference before creating cockpit sessions, and test both pane orders.

## blocks-the-design: Slot work panes still have no cockpit composer

W5b gets `hasJsonl` only from an activity section with the same `sessionId`. The activity route creates work sections only for five fixed IDs (`src/dashboard/server/routes/command-deck.ts:284-293`); the session-tree route explicitly includes additional slot work sessions (`src/dashboard/server/routes/projects.ts:225-229`). A live slot work pane therefore has no matching activity section, so W5b leaves `hasJsonl` unset. `SessionPanel.tsx:267-268,417-425` will not render `ConversationPanel` or its composer, even though presence is `idle`. Supply conversation availability for every live work pane from its own agent ID, or extend activity sections to those IDs, and add a slot-work cockpit test.

## blocks-the-design: Review pane cannot match its activity section

W5b matches a cockpit pane row to an activity section by `sessionId === pane.agentId`. The review activity section instead sets `sessionId` to `reviewPane.terminalId` when present (`src/dashboard/server/routes/command-deck.ts:458-469`); Herdr supplies a separate terminal ID and agent ID (`src/lib/terminal-backends/herdr.ts:891-897`). Thus a live review pane with JSONL gets no `hasJsonl` in the cockpit, and `SessionPanel.tsx:267-268,417-425` hides its conversation and composer. Align the review section's identity and JSONL lookup with the pane's agent ID, or match the terminal handle explicitly while keeping the transcript tied to that agent; test a review pane whose three IDs differ.
