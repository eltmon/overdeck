plan-digest: 8af5e16b7de2e869dd4768d7184c90e8d9a3be1ae16f51e694762d253544360e

## blocks-the-design: read-only notice text is unasserted

PRD FR-3 says the five-state component test asserts the text of `MachineReadOnlyNotice` for every non-live state. WI-2 instead checks only `screen.queryAllByTestId('machine-read-only-notice')` length, using `expected.readOnly`; the draft xBRIEF repeats that assertion. The browser spec also checks only the notice count (`tests/e2e/linked-conversation-title-bar.spec.ts`, line 144). The existing component test checks notice text for offline-saved and released, but has no offline-none text case (`src/dashboard/frontend/src/components/chat/__tests__/ConversationMachineBanner.test.tsx`, lines 66-75). Thus the planned test can pass if the offline-none notice text is wrong. Add expected notice text or a state-specific substring to the five-state table and assert it for all three non-live states, while asserting no notice for local and remote.
