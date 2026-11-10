plan-digest: c75685e0a03f4d6083f81d07fcdbc4871d3b87601a7e313c08efdda0e8451a30

## blocks-the-design: History loading races re-adoption

The PRD says the service awaits history before re-adopting pending pushes (D-8), but WI-5 line 556 specifies `void history.ready()`. WI-1 lines 338-342 load existing records asynchronously, while WI-4 lines 506-508 call synchronous `openEntryIdFor` only when a key first appears. The existing dispatcher skips an already-seen key on later observations (`src/lib/push/dispatcher.ts`, lines 169-170). If the first agent event or conversation scan arrives before the file read finishes, that old push is never tracked and its departure writes no resolution. Make startup wait for `ready()` before observing subjects, or explicitly re-adopt keys once loading finishes. Add a test that delays `ready()` past the first pending observation.

## blocks-the-design: A skipped target is counted as a sent push

WI-4 lines 493-497 records a `sent` line whenever `deliveries.length > 0`, and WI-1/FR-1 call that a push that reached a target. But `src/lib/push/webpush-provider.ts`, lines 109-110 returns one `{ ok: false, reason: 'skipped' }` outcome for a disallowed endpoint without sending anything. With that as the only outcome, the plan writes a sent-push history entry even though no push was attempted. Require at least one non-skipped provider outcome before recording a sent entry, and test the all-skipped case.

## blocks-the-design: The stored title can contain question text

D-4 and NFR-2 (PRD lines 113-118 and 218-219) claim that storing `title` but omitting `body` keeps question text off disk. `src/lib/push/classify.ts`, lines 128-135 and 165-176 build a question push title from the conversation title. A conversation title can be derived directly from the operator's prompt (`src/lib/overdeck/conversation-message.ts`, lines 679-682; `src/lib/conversations/transcript-summary.ts`, lines 255-285), or set manually (`src/lib/overdeck/conversation-reads.ts`, lines 794-799). A title containing a question or sensitive prompt is therefore copied to `push-sent.jsonl`. Store a safe title assembled from kind and issue ID, or narrow the privacy requirement explicitly if this disclosure is intended. Add a test with question text in the conversation title.

## blocks-the-design: Conversation warmth cannot prove an agent question left

D-8 (PRD lines 144-152) derives `resolved-without-answer` for an old unresolved push once 60 seconds and one conversation scan have passed. WI-5 lines 560-563 and 575-580 make that scan the only warm condition for every entry. Agent pending keys arrive through `agent.enrichment_changed` (`src/dashboard/server/services/needs-you-push-service.ts`, lines 151-155), while the agent poll can return without publishing when the census or backend is unavailable (`src/dashboard/server/services/agent-enrichment-service.ts`, lines 184-197). After a restart, a successful conversation scan can thus mark a still-pending agent question withdrawn when its agent event has not arrived. Derive a departed state for agent entries only after an authoritative agent snapshot or observation; otherwise leave the state unknown. Test a restarted agent entry with a successful conversation scan and no agent observation.
