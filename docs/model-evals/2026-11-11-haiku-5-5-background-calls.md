# Haiku 5.5 vs Haiku 4.5 for background calls: titles and compaction (2026-11-11)

PAN-5124 implementation checkpoint (PRD D12). It gates the Haiku 5.5 built-in defaults for the `cheap` workhorse, `conversations.title_model`, `conversations.compaction_model` and memory extraction.

## Verdict

**Move the cheap and background defaults to Haiku 5.5.** Haiku 5.5 was at least as good as Haiku 4.5 on 20 of 20 titles and 20 of 20 compactions, and it cost less per call on both.

- **Titles:** Haiku 5.5 was better on 17 of 20 and tied on 3. In two of the ties the titles say the same thing in different words; in the third, both missed the topic. Its titles keep the issue ID and the activity, while Haiku 4.5 often gives a generic phrase. Mean cost per call was $0.0006 against $0.0159, about 26 times cheaper, and wall time was 2.8 s against 8.0 s. Haiku 5.5 ran with `--effort low` (FR-3, already on this branch).
- **Compaction:** in a blinded comparison, Haiku 5.5 was better on 14 of 20 and tied on 6. Haiku 4.5 was better on none. Haiku 4.5 most often dropped open work (8 pairs) or concrete file paths (6 pairs). Haiku 5.5 dropped none of the four facts in any pair. Mean cost per call was $0.0268 against $0.0930, about 3.5 times cheaper, even though Haiku 5.5 used about 30% more input tokens for the same text. Compaction ran at the model default effort (D4).

## Method

- **Models:** `claude-haiku-4-5` and `claude-haiku-5-5`, called through the production code paths on this branch with Claude Code 2.1.322: `summarizeTranscriptTitle` for titles, and `generateSmartSummary({ jsonlPath, model, mode: 'compact' })` for compaction. The calls ran strictly one at a time, from an empty scratch directory.
- **Inputs:** Claude Code transcripts from `~/.claude/projects/`, read-only, from Overdeck project folders only, and none modified in the last 24 hours. The 20 title transcripts are 200-600 KB each and come from 14 project folders. The 20 compaction transcripts come from 17 project folders.
- **Title input:** the `user` and `assistant` text records in file order, through `serializeConversationTranscript(messages, { purpose: 'title' })`.
- **Cost:** cost is the `CostEvent` rows appended to `~/.overdeck/costs/events.jsonl` during each call. Title calls are tagged `background:titleRefinement` and compaction calls `background:summaryFork`, and rows are filtered by model. Every title call logged exactly one event. Every counted compaction logged one or two: two when a split turn adds a turn-prefix summary. The rows record wall time and token counts. Costs are list-price, API-equivalent. Total spend for the run was $2.72.
- **Counting compactions:** `summaryModel` is non-null on every row, but `generateSmartSummary` also sets it on the "nothing to summarize" stub. So a compaction row counts only when it logged at least one `background:summaryFork` event, which means a real model call ran.
- **Judging titles:** I judged the titles myself. For the three pairs where the topics disagreed, I checked the opening and closing turns of the transcript.
- **Judging compactions:** an Opus 5.5 subagent judged each compaction pair blind. The two summaries were labelled A and B with the order alternated, and the judge never saw the key. It scored four facts: goal, decisions, open work and file paths. A pair counts as "at least as good" for a model when the judge rated it better or tied.

### Deviation from the plan's input rule

The PRD asked for compaction inputs of 200-600 KB. In Overdeck-managed sessions, most of a file's bytes are launch-context `attachment` records. A 200-600 KB file usually holds only 5,000 to 13,000 tokens of messages, which is under the 20,000 tokens that compaction keeps verbatim. So most such files return the no-model stub: 176 of the 180 candidates in that window produced no model call. The 200 KB floor existed to make sure there is older history to summarize, so I kept that intent and widened the selection in two steps.

1. **Content filter:** 200 KB to 2.5 MB with at least 150,000 characters of message content. Of 26 candidates, 14 counted. The other 12 still returned the stub, mostly because they held a single very large message.
2. **Cut-point check:** the last candidates were picked with a port of `findCutPoint`, so each had history before the cut. Both candidates tried counted.

In all, 210 transcripts were tried and 20 counted; the other 190 produced no model call. The counted files are 438 KB to 2,440 KB, and 4 of them are under 600 KB. Titles keep the original 200-600 KB window.

## Results

### Titles

| # | Transcript | Project dir | Haiku 4.5 title | Haiku 4.5 cost | Haiku 5.5 title | Haiku 5.5 cost | Judgment |
|---|---|---|---|---|---|---|---|
| 1 | `35c4e6ca` | feature-pan-1641 | PAN-1641 async provisioning supervisor review | $0.0173 | PAN-1641 omp provisioning async review and verdict | $0.0008 | 5.5 better (more specific: issue ID and activity) |
| 2 | `5038ab3f` | feature-pan-3655 | PAN-3655 multi-reviewer approval synthesis | $0.0162 | PAN-3655 convoy review synthesis across four reviewers | $0.0008 | 5.5 better (more specific: issue ID and activity) |
| 3 | `5e6069c5` | feature-pan-3668 | Managed-session policy enforcement supervision | $0.0184 | PAN-3668 Prime managed-session policy review | $0.0008 | 5.5 better (more specific: issue ID and activity) |
| 4 | `41fd100a` | feature-pan-3671 | Verify testing gates for PAN-3671 | $0.0220 | PAN-3671 backend sanitizer and heal fixes verification | $0.0007 | 5.5 better (more specific: issue ID and activity) |
| 5 | `22db2d8c` | feature-pan-3680 | PAN-3680 foreman spawn and recovery | $0.0167 | PAN-3680 swarm foreman spawn review and fixes | $0.0009 | 5.5 better (more specific: issue ID and activity) |
| 6 | `bda7b132` | feature-pan-3684 | Overdeck dashboard project modules | $0.0152 | Overdeck memory context retrieval and prompt overflow | $0.0005 | 5.5 better (names the prompt overflow) |
| 7 | `1e75a26e` | feature-pan-3743 | codex-sweep-worker collector attribution pattern bugs | $0.0173 | Review codex cost collector attribution and AC3 test gap | $0.0006 | 5.5 better (more specific: issue ID and activity) |
| 8 | `dc1a4dd6` | feature-pan-3752 | Parse worker lane dispatch testing | $0.0156 | Verify parse-worker-op-and-lane acceptance criteria and typecheck | $0.0006 | 5.5 better (more specific: issue ID and activity) |
| 9 | `2f80d932` | feature-pan-3753 | Review-status retirement feature implementation | $0.0184 | PAN-3753 review-status retiredAt supervisor commit review | $0.0008 | 5.5 better (more specific: issue ID and activity) |
| 10 | `d09658e4` | feature-pan-3754 | PAN-3754 automated gates verification flow | $0.0157 | PAN-3754 memory governor test gates and verification | $0.0007 | 5.5 better (more specific: issue ID and activity) |
| 11 | `20ced523` | feature-pan-3836 | Work agent task completion verification PAN-3836 | $0.0148 | PAN-3836 verification gate stuck, pan work done | $0.0004 | 5.5 better (more specific: issue ID and activity) |
| 12 | `13e7fd73` | feature-pan-3841 | PAN-3841 resolver fixtures and prompt injection fixes | $0.0143 | PAN-3841 resolver tests and kickoff prompt fencing | $0.0005 | 5.5 better (more specific: issue ID and activity) |
| 13 | `2ba6b210` | feature-pan-3842 | Debug PAN-3842 model capability and slot spawning | $0.0137 | PAN-3842 tiered execution model capability fixes | $0.0005 | 5.5 better (more specific: issue ID and activity) |
| 14 | `000c4ee2` | main checkout | Backlog sequencing and planning workflow | $0.0153 | Backlog sequence refresh and commit for overdeck | $0.0005 | 5.5 better (more specific: issue ID and activity) |
| 15 | `14ca49b4` | main checkout | Backlog sequencing and dependency management | $0.0145 | Backlog sequencer no-change run and commit churn | $0.0005 | 5.5 better (more specific: issue ID and activity) |
| 16 | `29a5d71d` | main checkout | Overdeck incremental sequencer pass | $0.0154 | Overdeck backlog sequencer incremental update pass | $0.0006 | tie (equivalent wording) |
| 17 | `3ce81ae7` | main checkout | Write API transcripts fix handoff | $0.0143 | Overdeck WI-9 durability re-review handoff authoring | $0.0004 | 5.5 better (names handoff authoring) |
| 18 | `4e413b94` | main checkout | Planning feature development across multiple tickets | $0.0147 | Overdeck memory context and sibling planning hints | $0.0004 | tie (both miss the sequencer run) |
| 19 | `5ed5c09b` | main checkout | Overdeck backlog sequencer incremental pass | $0.0128 | Incremental overdeck backlog sequencing pass | $0.0005 | tie (equivalent wording) |
| 20 | `7200b4b2` | main checkout | Overdeck sequence commit and consistency gaps | $0.0145 | Overdeck incremental issue sequence regeneration and commit | $0.0006 | 5.5 better (more specific: issue ID and activity) |

### Compactions

| # | Transcript | Project dir | Size | Haiku 4.5 cost | Haiku 4.5 wall | Haiku 5.5 cost | Haiku 5.5 wall | Haiku 4.5 misses | Haiku 5.5 misses | Judgment |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `41fd100a` | feature-pan-3671 | 489 KB | $0.0399 | 21 s | $0.0062 | 15 s | none | none | tie |
| 2 | `22db2d8c` | feature-pan-3680 | 437 KB | $0.0256 | 13 s | $0.0048 | 12 s | none | none | tie |
| 3 | `d09658e4` | feature-pan-3754 | 525 KB | $0.0314 | 16 s | $0.0060 | 20 s | none | none | tie |
| 4 | `c6286eda` | feature-pan-1641 | 587 KB | $0.0798 | 30 s | $0.0144 | 24 s | open work | none | 5.5 better |
| 5 | `aafec2e9` | feature-pan-1166 | 2005 KB | $0.0701 | 30 s | $0.0116 | 26 s | open work, file paths | none | 5.5 better |
| 6 | `32c00fd3` | feature-pan-1641 | 2439 KB | $0.1086 | 37 s | $0.0160 | 29 s | goal | none | 5.5 better |
| 7 | `e34833f3` | feature-pan-2354 | 2245 KB | $0.0945 | 42 s | $0.0135 | 24 s | open work | none | 5.5 better |
| 8 | `c10eb8e2` | feature-pan-2444 | 2203 KB | $0.0910 | 39 s | $0.0140 | 28 s | decisions, open work | none | 5.5 better |
| 9 | `e9bed5f7` | feature-pan-2609 | 2153 KB | $0.0936 | 31 s | $0.0143 | 26 s | file paths | none | 5.5 better |
| 10 | `981a51af` | feature-pan-2630 | 2116 KB | $0.0789 | 44 s | $0.0124 | 30 s | open work, file paths | none | 5.5 better |
| 11 | `d8f791ac` | feature-pan-3420 | 1167 KB | $0.1319 | 39 s | $0.1005 | 24 s | file paths | none | 5.5 better |
| 12 | `b30cadee` | feature-pan-3655 | 2106 KB | $0.2057 | 36 s | $0.0309 | 28 s | open work | none | 5.5 better |
| 13 | `5772d8d3` | feature-pan-3668 | 2160 KB | $0.0914 | 21 s | $0.0141 | 17 s | decisions | none | 5.5 better |
| 14 | `e3a9ec24` | feature-pan-3671 | 1138 KB | $0.1185 | 21 s | $0.0188 | 23 s | none | none | tie |
| 15 | `0b39f608` | feature-pan-3727 | 1268 KB | $0.1127 | 27 s | $0.0168 | 18 s | none | none | tie |
| 16 | `5b466af4` | feature-pan-3752 | 2250 KB | $0.1425 | 22 s | $0.1045 | 17 s | open work | none | 5.5 better |
| 17 | `d5a61ea9` | feature-pan-3753 | 1312 KB | $0.1431 | 25 s | $0.1053 | 16 s | decisions, file paths | none | 5.5 better |
| 18 | `0e3a32e1` | feature-pan-3841 | 1921 KB | $0.0844 | 27 s | $0.0130 | 19 s | file paths | none | 5.5 better |
| 19 | `21b4cd39` | feature-pan-1254 | 1973 KB | $0.0618 | 25 s | $0.0095 | 21 s | none | none | tie |
| 20 | `6acd8201` | feature-pan-1641 | 1308 KB | $0.0546 | 25 s | $0.0086 | 21 s | open work | none | 5.5 better |

### Means

| Call type | Model | Rows | Mean cost per call | Mean wall time | Mean input tokens (incl. cache) | Mean output tokens |
|---|---|---|---|---|---|---|
| Title | `claude-haiku-4-5` | 20 | $0.01586 | 8.0 s | 6,966 | 730 |
| Title | `claude-haiku-5-5` | 20 | $0.00060 | 2.8 s | 5,625 | 135 |
| Compaction | `claude-haiku-4-5` | 20 | $0.09301 | 28.5 s | 63,009 | 1,341 |
| Compaction | `claude-haiku-5-5` | 20 | $0.02677 | 21.9 s | 81,681 | 1,857 |


## Caveats

- One run per call. Effort, prompt-caching state and output length vary between runs, so treat the cost ratios as approximate. The quality gap is large enough that one run should not hide a regression.
- The compaction quality judgment is one model's blinded rubric score, not a human review. The judge compared the two summaries with each other, never with the transcript, so the extra detail in Haiku 5.5's longer summaries was not checked for accuracy. The judge marked pairs 06, 09, 11 and 13 as less certain. Counting all four as ties would still give Haiku 5.5 20 of 20 at least as good.
- Titles were judged by the author, without blinding.
- The inputs are Overdeck pipeline sessions: work, review, planning and sequencer agents. Operator chat sessions in other projects were not sampled, so their generated titles stay out of this public doc.

Decision: GO
